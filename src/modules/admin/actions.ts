"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/session";
import { requireAccountAdmin, requireProjectAdmin } from "@/lib/auth";
import { LEVELS, SERVICES } from "@/lib/permissions";
import { parseInviteCsv } from "@/lib/csv";
import { ensureRootFolders } from "@/modules/docs/roots";
import { upsertMember } from "./members";
import type { ActionState } from "./types";

// ---------- helpers ----------

const service = z.enum(SERVICES);
const accessLevel = z.enum(["PROJECT_ADMIN", "MEMBER"]);

function fail(error: string, details?: string[]): ActionState {
  return { ok: false, error, details };
}

function firstIssue(e: z.ZodError) {
  const i = e.issues[0];
  return `${i.path.join(".") || "input"}: ${i.message}`;
}

async function audit(
  tx: Prisma.TransactionClient,
  actorId: string,
  projectId: string | null,
  action: string,
  details?: Prisma.InputJsonValue,
) {
  await tx.auditEvent.create({ data: { actorId, projectId, action, details } });
}

/** Make sure company/role ids come from the caller's own account. */
async function checkAccountRefs(accountId: string, companyId: string | null | undefined, roleIds: string[]) {
  if (companyId) {
    const c = await db.company.findFirst({ where: { id: companyId, accountId } });
    if (!c) throw new Error("Unknown company");
  }
  if (roleIds.length) {
    const n = await db.role.count({ where: { id: { in: roleIds }, accountId } });
    if (n !== roleIds.length) throw new Error("Unknown role");
  }
}

// ---------- auth ----------

const signUpSchema = z.object({
  organisation: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

export async function signUp(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { organisation, name, email, password } = parsed.data;
  if (await db.user.findUnique({ where: { email } })) return fail("An account with this email already exists. Sign in instead.");
  const user = await db.user.create({
    data: {
      email,
      name,
      passwordHash: await bcrypt.hash(password, 10),
      accountRole: "ACCOUNT_ADMIN",
      account: { create: { name: organisation } },
    },
  });
  await createSession(user.id);
  redirect("/projects");
}

const signInSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

export async function signIn(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Enter your email and password.");
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user?.passwordHash || !(await bcrypt.compare(parsed.data.password, user.passwordHash)))
    return fail("Email or password is incorrect.");
  await createSession(user.id);
  redirect("/projects");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}

const acceptSchema = z.object({
  token: z.string().min(10),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(200),
});

export async function acceptInvite(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = acceptSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const user = await db.user.findUnique({ where: { inviteToken: parsed.data.token } });
  if (!user) return fail("This invite link is invalid or has already been used.");
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { name: parsed.data.name, passwordHash: await bcrypt.hash(parsed.data.password, 10), inviteToken: null },
    }),
    db.projectMember.updateMany({ where: { userId: user.id }, data: { status: "ACTIVE" } }),
  ]);
  await createSession(user.id);
  redirect("/projects");
}

// ---------- projects ----------

const projectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().max(30).optional(),
  type: z.string().trim().max(60).optional(),
  location: z.string().trim().max(160).optional(),
  country: z.string().trim().max(60).optional(),
  currency: z.string().trim().length(3).toUpperCase().default("ZAR"),
  timezone: z.string().trim().max(60).default("Africa/Johannesburg"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export async function createProject(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireAccountAdmin();
  const parsed = projectSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  if (await db.project.findFirst({ where: { accountId: user.accountId, name: d.name } }))
    return fail("A project with this name already exists.");
  const project = await db.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        accountId: user.accountId,
        name: d.name,
        code: d.code || null,
        type: d.type || null,
        location: d.location || null,
        country: d.country || null,
        currency: d.currency,
        timezone: d.timezone,
        startDate: d.startDate ? new Date(d.startDate) : null,
        endDate: d.endDate ? new Date(d.endDate) : null,
      },
    });
    // creator becomes project admin with every service
    await tx.projectMember.create({
      data: { projectId: p.id, userId: user.id, accessLevel: "PROJECT_ADMIN", status: "ACTIVE", services: [...SERVICES] },
    });
    await ensureRootFolders(tx, p.id, user.id);
    await audit(tx, user.id, p.id, "project.created", { name: p.name });
    return p;
  });
  redirect(`/projects/${project.id}/admin/members`);
}

// ---------- members ----------

const memberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(120).default(""),
  companyId: z.string().optional(),
  roleIds: z.array(z.string()).default([]),
  accessLevel: accessLevel.default("MEMBER"),
  services: z.array(service).default([]),
});

function memberFromForm(form: FormData) {
  return memberSchema.safeParse({
    email: form.get("email"),
    name: form.get("name") ?? "",
    companyId: (form.get("companyId") as string) || undefined,
    roleIds: form.getAll("roleIds").filter(Boolean),
    accessLevel: form.get("accessLevel") || undefined,
    services: form.getAll("services"),
  });
}

export async function addMember(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { user } = await requireProjectAdmin(projectId);
  const parsed = memberFromForm(form);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    await checkAccountRefs(user.accountId, parsed.data.companyId, parsed.data.roleIds);
    const res = await db.$transaction(async (tx) => {
      const r = await upsertMember(tx, user.accountId, projectId, parsed.data);
      await audit(tx, user.id, projectId, r.created ? "member.added" : "member.updated", { email: parsed.data.email });
      return r;
    });
    revalidatePath(`/projects/${projectId}/admin`, "layout");
    return { ok: true, message: res.created ? `Added ${parsed.data.email}` : `Updated ${parsed.data.email}` };
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function updateMember(projectId: string, memberId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { user } = await requireProjectAdmin(projectId);
  const member = await db.projectMember.findFirst({ where: { id: memberId, projectId }, include: { user: true } });
  if (!member) return fail("Member not found");
  form.set("email", member.user.email);
  const parsed = memberFromForm(form);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  if (member.userId === user.id && parsed.data.accessLevel !== "PROJECT_ADMIN" && user.accountRole !== "ACCOUNT_ADMIN")
    return fail("You can't remove your own admin access.");
  try {
    await checkAccountRefs(user.accountId, parsed.data.companyId, parsed.data.roleIds);
    await db.$transaction(async (tx) => {
      await upsertMember(tx, user.accountId, projectId, parsed.data);
      await audit(tx, user.id, projectId, "member.updated", { email: member.user.email });
    });
  } catch (e) {
    return fail((e as Error).message);
  }
  revalidatePath(`/projects/${projectId}/admin`, "layout");
  return { ok: true, message: "Saved" };
}

export async function removeMember(projectId: string, memberId: string) {
  const { user } = await requireProjectAdmin(projectId);
  const member = await db.projectMember.findFirst({ where: { id: memberId, projectId }, include: { user: true } });
  if (!member || member.userId === user.id) return;
  await db.$transaction(async (tx) => {
    await tx.projectMember.delete({ where: { id: member.id } });
    await tx.servicePermission.deleteMany({ where: { projectId, subjectType: "USER", subjectId: member.userId } });
    await audit(tx, user.id, projectId, "member.removed", { email: member.user.email });
  });
  revalidatePath(`/projects/${projectId}/admin`, "layout");
}

/** CSV bulk invite. Unknown companies/roles are created on the fly. */
export async function bulkInvite(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { user } = await requireProjectAdmin(projectId);
  const csv = String(form.get("csv") ?? "");
  const services = z.array(service).safeParse(form.getAll("services"));
  if (!services.success) return fail("Invalid services");
  const { rows, errors } = parseInviteCsv(csv);
  if (!rows.length) return fail("No valid rows found.", errors.map((e) => `Line ${e.line}: ${e.message}`));
  const details = errors.map((e) => `Line ${e.line}: ${e.message} (skipped)`);
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    try {
      await db.$transaction(async (tx) => {
        const company = row.company
          ? await tx.company.upsert({
              where: { accountId_name: { accountId: user.accountId, name: row.company } },
              create: { accountId: user.accountId, name: row.company },
              update: {},
            })
          : null;
        const role = row.role
          ? await tx.role.upsert({
              where: { accountId_name: { accountId: user.accountId, name: row.role } },
              create: { accountId: user.accountId, name: row.role },
              update: {},
            })
          : null;
        const r = await upsertMember(tx, user.accountId, projectId, {
          email: row.email,
          name: row.name,
          companyId: company?.id ?? null,
          roleIds: role ? [role.id] : [],
          accessLevel: row.accessLevel,
          services: services.data,
        });
        if (r.created) added++;
        else updated++;
      });
    } catch (e) {
      details.push(`Line ${row.line}: ${(e as Error).message} (skipped)`);
    }
  }
  await db.auditEvent.create({ data: { actorId: user.id, projectId, action: "member.bulk_invite", details: { added, updated } } });
  revalidatePath(`/projects/${projectId}/admin`, "layout");
  return { ok: true, message: `${added} added, ${updated} updated`, details };
}

/**
 * Add one person to many projects at once — a long-standing request on the
 * BIM 360 / ACC ideas boards that is still unshipped there.
 */
export async function addUserToProjects(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireAccountAdmin();
  const parsed = memberFromForm(form);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const projectIds = form.getAll("projectIds").map(String).filter(Boolean);
  if (!projectIds.length) return fail("Pick at least one project.");
  const projects = await db.project.findMany({ where: { id: { in: projectIds }, accountId: user.accountId } });
  if (projects.length !== projectIds.length) return fail("Unknown project");
  try {
    await checkAccountRefs(user.accountId, parsed.data.companyId, parsed.data.roleIds);
    await db.$transaction(async (tx) => {
      for (const p of projects) {
        await upsertMember(tx, user.accountId, p.id, parsed.data);
        await audit(tx, user.id, p.id, "member.added_multi_project", { email: parsed.data.email, projects: projects.length });
      }
    });
  } catch (e) {
    return fail((e as Error).message);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `${parsed.data.email} now has access to ${projects.length} project(s).` };
}

// ---------- companies & roles ----------

const companySchema = z.object({
  name: z.string().trim().min(2).max(120),
  trade: z.string().trim().max(80).optional(),
  country: z.string().trim().max(60).optional(),
});

export async function createCompany(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { user } = await requireProjectAdmin(projectId);
  const parsed = companySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  if (await db.company.findFirst({ where: { accountId: user.accountId, name: parsed.data.name } }))
    return fail("That company already exists.");
  await db.company.create({
    data: { accountId: user.accountId, name: parsed.data.name, trade: parsed.data.trade || null, country: parsed.data.country || null },
  });
  revalidatePath(`/projects/${projectId}/admin`, "layout");
  return { ok: true, message: `Added ${parsed.data.name}` };
}

export async function createRole(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { user } = await requireProjectAdmin(projectId);
  const parsed = z.object({ name: z.string().trim().min(2).max(80) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  if (await db.role.findFirst({ where: { accountId: user.accountId, name: parsed.data.name } }))
    return fail("That role already exists.");
  await db.role.create({ data: { accountId: user.accountId, name: parsed.data.name } });
  revalidatePath(`/projects/${projectId}/admin`, "layout");
  return { ok: true, message: `Added ${parsed.data.name}` };
}

// ---------- service permissions ----------

const permSchema = z.object({
  service,
  subjectType: z.enum(["USER", "ROLE", "COMPANY"]),
  subjectId: z.string().min(1),
  level: z.enum(LEVELS),
});

export async function setServicePermission(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { user } = await requireProjectAdmin(projectId);
  const [rawType, rawId] = String(form.get("subject") ?? "").split(":");
  const parsed = permSchema.safeParse({ service: form.get("service"), level: form.get("level"), subjectType: rawType, subjectId: rawId });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { service: svc, subjectType, subjectId, level } = parsed.data;
  // subject must belong to this account / project
  const valid =
    subjectType === "USER"
      ? await db.projectMember.findFirst({ where: { projectId, userId: subjectId } })
      : subjectType === "ROLE"
        ? await db.role.findFirst({ where: { id: subjectId, accountId: user.accountId } })
        : await db.company.findFirst({ where: { id: subjectId, accountId: user.accountId } });
  if (!valid) return fail("Unknown user, role or company");
  const key = { projectId_service_subjectType_subjectId: { projectId, service: svc, subjectType, subjectId } };
  await db.$transaction(async (tx) => {
    if (level === "NONE") await tx.servicePermission.deleteMany({ where: { projectId, service: svc, subjectType, subjectId } });
    else await tx.servicePermission.upsert({ where: key, create: { projectId, service: svc, subjectType, subjectId, level }, update: { level } });
    await audit(tx, user.id, projectId, "permission.set", { service: svc, subjectType, subjectId, level });
  });
  revalidatePath(`/projects/${projectId}/admin`, "layout");
  return { ok: true, message: "Permission saved" };
}
