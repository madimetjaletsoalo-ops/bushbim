"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";
import { can, type Grant } from "@/lib/permissions";
import type { ActionState } from "@/modules/admin/types";
import { getDocsContext } from "@/modules/docs/access";
import { levelAtLeast } from "@/modules/docs/folder-permissions";
import { MAX_FILES_PER_REVIEW, OUTCOMES, parseStatuses, readWorkflowForm, workflowSchema } from "./logic";
import { advanceReview, canInitiate, createReview, eligibleReviewers, projectMembers, reviewAccess, toStepDef } from "./server";

// Access rules:
// - define, (de)activate and delete workflows: project admins and Document Control Managers
// - start a review: the workflow's initiators (or any Document Control Creator when none are set),
//   with at least View on every file's folder
// - decide: the reviewers of the review's current step
// Every mutation writes an AuditEvent.

const fail = (error: string): ActionState => ({ ok: false, error });
const idSchema = z.string().min(1).max(64);
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const revalidateReviews = (projectId: string) => revalidatePath(`/projects/${projectId}/reviews`, "layout");

async function workflowAdmin(projectId: string) {
  const ctx = await getProjectContext(projectId);
  return ctx.isAdmin || can(ctx.member, "DOCS", "manage", ctx.grants) ? ctx : null;
}

/** Checks every "TYPE:id" subject belongs to this project (users) or account (roles, companies). */
async function subjectsValid(projectId: string, accountId: string, subjects: string[]) {
  const ids = (t: string) => subjects.filter((s) => s.startsWith(`${t}:`)).map((s) => s.slice(t.length + 1));
  const [users, roles, companies] = [ids("USER"), ids("ROLE"), ids("COMPANY")];
  const [u, r, c] = await Promise.all([
    users.length ? db.projectMember.count({ where: { projectId, userId: { in: users } } }) : 0,
    roles.length ? db.role.count({ where: { accountId, id: { in: roles } } }) : 0,
    companies.length ? db.company.count({ where: { accountId, id: { in: companies } } }) : 0,
  ]);
  return u === new Set(users).size && r === new Set(roles).size && c === new Set(companies).size;
}

// ---------- workflows ----------

export async function createWorkflow(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await workflowAdmin(projectId);
  if (!ctx) return fail("Only project admins and Document Control managers can define workflows.");
  const parsed = workflowSchema.safeParse(readWorkflowForm(form));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid workflow");
  const w = parsed.data;
  const allSubjects = [...w.initiators, ...w.steps.flatMap((s) => s.reviewers)];
  if (!(await subjectsValid(projectId, ctx.user.accountId, allSubjects))) return fail("A reviewer or initiator isn't part of this project.");
  for (const fid of [w.autoStartFolderId, w.approvedFolderId])
    if (fid && !(await db.folder.findFirst({ where: { id: fid, projectId } }))) return fail("Choose a folder in this project.");
  if (w.autoStartFolderId && w.autoStartFolderId === w.approvedFolderId)
    return fail("Approved files can't go to the folder that starts the review, or every approval would start another review.");
  try {
    await db.$transaction(async (tx) => {
      const created = await tx.reviewWorkflow.create({
        data: {
          projectId,
          name: w.name,
          description: w.description || null,
          statuses: w.statuses,
          initiators: w.initiators,
          autoStartFolderId: w.autoStartFolderId,
          approvedFolderId: w.approvedFolderId,
          steps: { create: w.steps.map((s, i) => ({ order: i + 1, name: s.name, reviewers: s.reviewers, mode: s.mode, days: s.days })) },
        },
      });
      await tx.auditEvent.create({
        data: { actorId: ctx.user.id, projectId, action: "review_workflow.created", details: { workflowId: created.id, name: w.name, steps: w.steps.length } },
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("A workflow with this name already exists.");
    throw e;
  }
  revalidateReviews(projectId);
  return { ok: true, message: `Created workflow ${w.name}` };
}

export async function setWorkflowActive(projectId: string, workflowId: string, active: boolean) {
  const ctx = await workflowAdmin(projectId);
  if (!ctx || !idSchema.safeParse(workflowId).success) return;
  const wf = await db.reviewWorkflow.findFirst({ where: { id: workflowId, projectId } });
  if (!wf || wf.active === active) return;
  await db.$transaction(async (tx) => {
    await tx.reviewWorkflow.update({ where: { id: wf.id }, data: { active } });
    await tx.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: active ? "review_workflow.activated" : "review_workflow.deactivated", details: { workflowId, name: wf.name } },
    });
  });
  revalidateReviews(projectId);
}

/** Deletes a workflow that was never used; used ones can only be deactivated. */
export async function deleteWorkflow(projectId: string, workflowId: string) {
  const ctx = await workflowAdmin(projectId);
  if (!ctx || !idSchema.safeParse(workflowId).success) return;
  const wf = await db.reviewWorkflow.findFirst({ where: { id: workflowId, projectId }, include: { _count: { select: { reviews: true } } } });
  if (!wf || wf._count.reviews > 0) return;
  await db.$transaction(async (tx) => {
    await tx.reviewWorkflow.delete({ where: { id: wf.id } });
    await tx.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "review_workflow.deleted", details: { workflowId, name: wf.name } } });
  });
  revalidateReviews(projectId);
}

// ---------- reviews ----------

const startSchema = z.object({
  workflowId: idSchema,
  name: z.string().trim().min(1, "Give the review a name").max(200),
  versionIds: z.array(idSchema).min(1, "Choose at least one file").max(MAX_FILES_PER_REVIEW, `A review can have up to ${MAX_FILES_PER_REVIEW} files`),
});

export async function startReview(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getDocsContext(projectId);
  if (!can(ctx.member, "DOCS", "view", ctx.grants)) return fail("You don't have access to Document Control.");
  const parsed = startSchema.safeParse({
    workflowId: form.get("workflowId") ?? "",
    name: form.get("name") ?? "",
    versionIds: [...new Set(form.getAll("versionIds").filter((x) => typeof x === "string"))],
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { workflowId, name, versionIds } = parsed.data;
  const wf = await db.reviewWorkflow.findFirst({ where: { id: workflowId, projectId, active: true }, include: { steps: { orderBy: { order: "asc" } } } });
  if (!wf || !wf.steps.length) return fail("Choose an active workflow.");
  if (!canInitiate(ctx.member, ctx.grants, wf.initiators)) return fail(`You can't start reviews with "${wf.name}".`);
  const versions = await db.documentVersion.findMany({ where: { id: { in: versionIds }, document: { projectId } }, include: { document: { select: { folderId: true } } } });
  if (versions.length !== versionIds.length || versions.some((v) => !levelAtLeast(ctx.levelOn(v.document.folderId), "VIEW")))
    return fail("You don't have access to one of the files.");
  const members = await projectMembers(projectId);
  for (const s of wf.steps.map(toStepDef))
    if (eligibleReviewers(members, ctx.grants, s).length === 0) return fail(`Step ${s.order} "${s.name}" has no reviewer who can open Document Control.`);
  const review = await createReview({ projectId, workflowId: wf.id, name, versionIds, initiatorId: ctx.user.id, firstStepDays: wf.steps[0].days, auto: false });
  revalidateReviews(projectId);
  redirect(`/projects/${projectId}/reviews/${review.id}`);
}

const decisionSchema = z.object({
  outcome: z.enum(OUTCOMES, { errorMap: () => ({ message: "Choose a status for every file" }) }),
  comment: z.string().trim().max(2000, "Comments must be 2000 characters or fewer"),
});

export async function submitDecision(projectId: string, reviewId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await reviewAccess(projectId, reviewId);
  if (!ctx) return fail("Review not found.");
  const { review, current } = ctx;
  if (!current || review.status !== "OPEN") return fail("This review is closed.");
  if (!ctx.canReviewNow || eligibleReviewers([{ ...ctx.member, name: ctx.user.name }], ctx.grants as Grant[], current).length === 0)
    return fail(`You aren't a reviewer of step ${current.order} "${current.name}".`);
  const statuses = parseStatuses(review.workflow.statuses);
  const step = Number(form.get("step"));
  if (step !== current.order) return fail("This review moved to another step. Reload the page.");
  const rows: { reviewDocumentId: string; outcome: (typeof OUTCOMES)[number]; comment: string }[] = [];
  for (const d of review.documents) {
    const p = decisionSchema.safeParse({ outcome: form.get(`outcome_${d.id}`) || undefined, comment: form.get(`comment_${d.id}`) ?? "" });
    if (!p.success) return fail(`${d.version.document.name}: ${p.error.issues[0]?.message ?? "invalid"}`);
    if (!statuses.some((s) => s.code === p.data.outcome)) return fail(`${d.version.document.name}: that status isn't used by this workflow.`);
    rows.push({ reviewDocumentId: d.id, ...p.data });
  }
  await db.$transaction(async (tx) => {
    for (const r of rows)
      await tx.reviewDecision.upsert({
        where: { reviewDocumentId_step_reviewerId: { reviewDocumentId: r.reviewDocumentId, step, reviewerId: ctx.user.id } },
        create: { reviewId, reviewDocumentId: r.reviewDocumentId, step, reviewerId: ctx.user.id, outcome: r.outcome, comment: r.comment || null },
        update: { outcome: r.outcome, comment: r.comment || null },
      });
    const tally: Record<string, number> = {};
    for (const r of rows) tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
    await tx.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "review.decision", details: { reviewId, number: review.number, step, outcomes: tally } },
    });
  });
  const result = await advanceReview(reviewId, ctx.user.id);
  revalidateReviews(projectId);
  const message =
    result === "closed" ? "Review closed." : result === "next" ? `Step ${step} complete. Sent to step ${step + 1}.` : "Saved. Waiting for the other reviewers.";
  return { ok: true, message };
}
