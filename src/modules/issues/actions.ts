"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ActionState } from "@/modules/admin/types";
import { HEX_COLOR, changedFields, fieldLabels, issueLabel, issueSchema, parseAssignee, parseOptions, validateAttributes, type IssueInput } from "./logic";
import { accessFor, createIssueRow, getIssuesContext, type IssuesContext } from "./server";

// Access rules live in logic.ts (issueAccess). Every action re-checks them and writes an AuditEvent.

const fail = (error: string): ActionState => ({ ok: false, error });
const ok = (message: string): ActionState => ({ ok: true, message });
const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};
const strings = (form: FormData, key: string) => [...new Set(form.getAll(key).filter((x): x is string => typeof x === "string" && !!x))];
const idSchema = z.string().min(1).max(64);
const nameSchema = z.string().trim().min(1, "Enter a name").max(60, "Keep names under 60 characters");
const unique = (e: unknown) => typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
/** Names are unique per list regardless of case ("Closed" and "closed" clash). */
const taken = (list: { id: string; name: string }[], name: string, exceptId?: string) =>
  list.some((x) => x.id !== exceptId && x.name.toLowerCase() === name.toLowerCase());
const refresh = (projectId: string) => revalidatePath(`/projects/${projectId}/issues`, "layout");
const audit = (ctx: IssuesContext, action: string, details: Prisma.InputJsonValue) =>
  db.auditEvent.create({ data: { actorId: ctx.user.id, projectId: ctx.project.id, action, details } });

// ---------- issue fields ----------

type Resolved = {
  data: {
    title: string;
    description: string | null;
    typeId: string | null;
    subtypeId: string | null;
    assigneeType: "USER" | "ROLE" | "COMPANY" | null;
    assigneeId: string | null;
    dueDate: Date | null;
    locationId: string | null;
    rootCauseId: string | null;
    attributes: Record<string, string>;
  };
  statusId: string | null;
  watcherIds: string[];
};

/** Validates the issue form and checks that every referenced type, status, person and place belongs to this project. */
function resolveIssueForm(ctx: IssuesContext, form: FormData, existing?: { typeId: string | null; subtypeId: string | null }): Resolved | { error: string } {
  const parsed = issueSchema.safeParse({
    title: str(form, "title"),
    description: str(form, "description"),
    typeId: str(form, "typeId"),
    subtypeId: str(form, "subtypeId"),
    statusId: str(form, "statusId"),
    assignee: str(form, "assignee"),
    dueDate: str(form, "dueDate"),
    locationId: str(form, "locationId"),
    rootCauseId: str(form, "rootCauseId"),
    watcherIds: strings(form, "watcherIds"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v: IssueInput = parsed.data;

  // a deactivated type or subtype may stay on an issue that already has it, but can't be newly chosen
  const type = v.typeId ? ctx.types.find((t) => t.id === v.typeId && (t.active || t.id === existing?.typeId)) : null;
  if (v.typeId && !type) return { error: "Choose a type from the list." };
  const subtype = v.subtypeId ? type?.subtypes.find((s) => s.id === v.subtypeId && (s.active || s.id === existing?.subtypeId)) : null;
  if (v.subtypeId && !subtype) return { error: "That subtype doesn't belong to the chosen type." };
  if (v.statusId && !ctx.statuses.some((s) => s.id === v.statusId)) return { error: "Choose a status from the list." };
  const assignee = v.assignee ? parseAssignee(v.assignee) : null;
  if (v.assignee && (!assignee || !ctx.isAssignee(v.assignee))) return { error: "Assign the issue to a project member, a role or a company." };
  if (v.locationId && !ctx.locations.some((l) => l.id === v.locationId)) return { error: "Choose a location from the list." };
  if (v.rootCauseId && !ctx.rootCauses.some((r) => r.id === v.rootCauseId)) return { error: "Choose a root cause from the list." };
  const memberIds = new Set(ctx.members.map((m) => m.userId));
  if (v.watcherIds.some((id) => !memberIds.has(id))) return { error: "Watchers must be project members." };

  const attrs = validateAttributes(
    ctx.attributes,
    Object.fromEntries(ctx.attributes.map((a) => [a.id, str(form, `attr_${a.id}`)])),
  );
  if ("error" in attrs) return attrs;

  return {
    data: {
      title: v.title,
      description: v.description || null,
      typeId: type?.id ?? null,
      subtypeId: subtype?.id ?? null,
      assigneeType: assignee?.type ?? null,
      assigneeId: assignee?.id ?? null,
      dueDate: v.dueDate,
      locationId: v.locationId,
      rootCauseId: v.rootCauseId,
      attributes: attrs.values,
    },
    statusId: v.statusId,
    watcherIds: v.watcherIds,
  };
}

export async function createIssue(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getIssuesContext(projectId);
  if (!ctx.canCreate) return fail("Creating issues needs Issues Creator access.");
  const r = resolveIssueForm(ctx, form);
  if ("error" in r) return fail(r.error);
  const status = ctx.statuses.find((s) => s.id === r.statusId) ?? ctx.statuses.find((s) => s.isDefault) ?? ctx.statuses.find((s) => !s.draft && !s.closed);
  if (!status) return fail("This project has no issue statuses. Ask a Manager to add one.");
  const issue = await createIssueRow(
    { projectId, ...r.data, statusId: status.id, createdById: ctx.user.id, closedAt: status.closed ? new Date() : null },
    // the creator watches their own issue
    [...new Set([ctx.user.id, ...r.watcherIds])],
    ctx.user.id,
  );
  refresh(projectId);
  redirect(`/projects/${projectId}/issues/${issue.id}`);
}

async function loadIssue(ctx: IssuesContext, issueId: string) {
  if (!idSchema.safeParse(issueId).success) return null;
  const issue = await db.issue.findFirst({ where: { id: issueId, projectId: ctx.project.id }, include: { status: true, watchers: true } });
  return issue ? { issue, access: accessFor(ctx, issue) } : null;
}

export async function updateIssue(projectId: string, issueId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getIssuesContext(projectId);
  const found = await loadIssue(ctx, issueId);
  if (!found?.access.see) return fail("Issue not found.");
  if (!found.access.edit) return fail(ctx.level === "CREATOR" ? "Creators can edit only the issues they created." : "You can't edit this issue.");
  const { issue } = found;
  const r = resolveIssueForm(ctx, form, issue);
  if ("error" in r) return fail(r.error);
  const changed = changedFields(issue, r.data);
  const watchersBefore = issue.watchers.map((w) => w.userId).sort();
  const watchersAfter = [...r.watcherIds].sort();
  const watchersChanged = watchersBefore.join() !== watchersAfter.join();
  if (!changed.length && !watchersChanged) return ok("No changes.");
  await db.$transaction(async (tx) => {
    await tx.issue.update({ where: { id: issue.id }, data: r.data });
    if (watchersChanged) {
      await tx.issueWatcher.deleteMany({ where: { issueId: issue.id, userId: { notIn: watchersAfter } } });
      await tx.issueWatcher.createMany({ data: watchersAfter.map((userId) => ({ issueId: issue.id, userId })), skipDuplicates: true });
    }
    await tx.auditEvent.create({
      data: {
        actorId: ctx.user.id,
        projectId,
        action: "issue.updated",
        details: { issueId: issue.id, number: issue.number, fields: fieldLabels(watchersChanged ? [...changed, "watchers"] : changed) },
      },
    });
  });
  refresh(projectId);
  return ok("Issue saved.");
}

export async function changeIssueStatus(projectId: string, issueId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getIssuesContext(projectId);
  const found = await loadIssue(ctx, issueId);
  if (!found?.access.see) return fail("Issue not found.");
  if (!found.access.status) return fail("Only the assignee, the issue's creator or an Issues Manager can change its status.");
  const status = ctx.statuses.find((s) => s.id === str(form, "statusId"));
  if (!status) return fail("Choose a status from the list.");
  const { issue } = found;
  if (status.id === issue.statusId) return ok("Status unchanged.");
  const comment = str(form, "comment").trim().slice(0, 5000);
  await db.$transaction(async (tx) => {
    await tx.issue.update({
      where: { id: issue.id },
      data: { statusId: status.id, closedAt: status.closed ? (issue.status.closed ? issue.closedAt : new Date()) : null },
    });
    if (comment) await tx.issueComment.create({ data: { issueId: issue.id, authorId: ctx.user.id, body: comment } });
    await tx.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "issue.status_changed", details: { issueId: issue.id, number: issue.number, from: issue.status.name, to: status.name } },
    });
  });
  refresh(projectId);
  return ok(`Status changed to ${status.name}.`);
}

export async function addIssueComment(projectId: string, issueId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getIssuesContext(projectId);
  const found = await loadIssue(ctx, issueId);
  if (!found?.access.comment) return fail("Issue not found.");
  const body = z.string().trim().min(1, "Write a comment first").max(5000, "Keep comments under 5000 characters").safeParse(str(form, "body"));
  if (!body.success) return fail(body.error.issues[0]?.message ?? "Invalid comment");
  await db.$transaction([
    db.issueComment.create({ data: { issueId, authorId: ctx.user.id, body: body.data } }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "issue.commented", details: { issueId, number: found.issue.number } } }),
  ]);
  refresh(projectId);
  return ok("Comment added.");
}

/** Watch or stop watching an issue yourself. */
export async function toggleWatch(projectId: string, issueId: string) {
  const ctx = await getIssuesContext(projectId);
  const found = await loadIssue(ctx, issueId);
  if (!found?.access.see) return;
  const watching = found.issue.watchers.some((w) => w.userId === ctx.user.id);
  await db.$transaction([
    watching
      ? db.issueWatcher.deleteMany({ where: { issueId, userId: ctx.user.id } })
      : db.issueWatcher.createMany({ data: [{ issueId, userId: ctx.user.id }], skipDuplicates: true }),
    db.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: watching ? "issue.unwatched" : "issue.watched", details: { issueId, number: found.issue.number, label: issueLabel(found.issue.number) } },
    }),
  ]);
  refresh(projectId);
}

// ---------- settings (Issues Managers) ----------

async function manager(projectId: string) {
  const ctx = await getIssuesContext(projectId);
  return ctx.canManage ? ctx : null;
}
const NOT_MANAGER = "Changing Issues settings needs Issues Manager access.";

export async function saveStatus(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await manager(projectId);
  if (!ctx) return fail(NOT_MANAGER);
  const id = str(form, "id");
  const name = nameSchema.safeParse(str(form, "name"));
  if (!name.success) return fail(name.error.issues[0]!.message);
  const color = str(form, "color") || "#6b7280";
  if (!HEX_COLOR.test(color)) return fail("Pick a colour.");
  const closed = form.get("closed") === "on";
  const draft = form.get("draft") === "on" && !closed;
  const existing = id ? ctx.statuses.find((s) => s.id === id) : null;
  if (id && !existing) return fail("Status not found.");
  const parentId = str(form, "parentId") || null;
  if (!existing && parentId) {
    const parent = ctx.statuses.find((s) => s.id === parentId);
    if (!parent || parent.parentId) return fail("Sub-statuses go one level deep: choose a top-level status as the parent.");
  }
  if (taken(ctx.statuses, name.data, existing?.id)) return fail(`There is already a status called "${name.data}".`);
  if (existing?.isDefault && (closed || draft)) return fail("The default status for new issues can't be closed or draft.");
  try {
    if (existing) {
      await db.issueStatus.update({ where: { id: existing.id }, data: { name: name.data, color, closed, draft } });
      await audit(ctx, "issue_status.updated", { statusId: existing.id, from: existing.name, name: name.data, color, closed, draft });
    } else {
      const parent = parentId ? ctx.statuses.find((s) => s.id === parentId) : null;
      const siblings = ctx.statuses.filter((s) => s.parentId === parentId);
      const s = await db.issueStatus.create({
        data: { projectId, name: name.data, color, closed: parent ? parent.closed : closed, draft: parent ? parent.draft : draft, parentId, order: siblings.reduce((m, x) => Math.max(m, x.order), -1) + 1 },
      });
      await audit(ctx, "issue_status.created", { statusId: s.id, name: s.name, parent: parent?.name ?? null });
    }
  } catch (e) {
    if (unique(e)) return fail(`There is already a status called "${name.data}".`);
    throw e;
  }
  refresh(projectId);
  return ok(existing ? "Status saved." : `Added status ${name.data}.`);
}

export async function deleteStatus(projectId: string, statusId: string) {
  const ctx = await manager(projectId);
  const s = ctx?.statuses.find((x) => x.id === statusId);
  if (!ctx || !s || s.isDefault) return;
  const [inUse, children] = await Promise.all([db.issue.count({ where: { statusId } }), db.issueStatus.count({ where: { parentId: statusId } })]);
  if (inUse || children) return;
  await db.issueStatus.delete({ where: { id: statusId } });
  await audit(ctx, "issue_status.deleted", { statusId, name: s.name });
  refresh(projectId);
}

export async function setDefaultStatus(projectId: string, statusId: string) {
  const ctx = await manager(projectId);
  const s = ctx?.statuses.find((x) => x.id === statusId);
  if (!ctx || !s || s.closed || s.draft) return;
  await db.$transaction([
    db.issueStatus.updateMany({ where: { projectId }, data: { isDefault: false } }),
    db.issueStatus.update({ where: { id: statusId }, data: { isDefault: true } }),
  ]);
  await audit(ctx, "issue_status.default", { statusId, name: s.name });
  refresh(projectId);
}

/** Swaps a status with its neighbour among its siblings. */
export async function moveStatus(projectId: string, statusId: string, dir: "up" | "down") {
  const ctx = await manager(projectId);
  const s = ctx?.statuses.find((x) => x.id === statusId);
  if (!ctx || !s) return;
  const siblings = ctx.statuses.filter((x) => x.parentId === s.parentId);
  const i = siblings.findIndex((x) => x.id === statusId);
  const other = siblings[dir === "up" ? i - 1 : i + 1];
  if (!other) return;
  // re-number the siblings so equal orders can't stall the swap
  const order = siblings.map((x) => x.id);
  [order[i], order[siblings.indexOf(other)]] = [order[siblings.indexOf(other)], order[i]];
  await db.$transaction(order.map((id, n) => db.issueStatus.update({ where: { id }, data: { order: n } })));
  await audit(ctx, "issue_status.moved", { statusId, name: s.name, dir });
  refresh(projectId);
}

export async function addType(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await manager(projectId);
  if (!ctx) return fail(NOT_MANAGER);
  const name = nameSchema.safeParse(str(form, "name"));
  if (!name.success) return fail(name.error.issues[0]!.message);
  const typeId = str(form, "typeId");
  try {
    if (typeId) {
      const type = ctx.types.find((t) => t.id === typeId);
      if (!type) return fail("Type not found.");
      if (taken(type.subtypes, name.data)) return fail(`"${name.data}" already exists.`);
      const s = await db.issueSubtype.create({ data: { typeId, name: name.data } });
      await audit(ctx, "issue_type.subtype_created", { typeId, subtypeId: s.id, type: type.name, name: s.name });
    } else {
      if (taken(ctx.types, name.data)) return fail(`"${name.data}" already exists.`);
      const t = await db.issueType.create({ data: { projectId, name: name.data } });
      await audit(ctx, "issue_type.created", { typeId: t.id, name: t.name });
    }
  } catch (e) {
    if (unique(e)) return fail(`"${name.data}" already exists.`);
    throw e;
  }
  refresh(projectId);
  return ok(`Added ${name.data}.`);
}

export async function renameType(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await manager(projectId);
  if (!ctx) return fail(NOT_MANAGER);
  const name = nameSchema.safeParse(str(form, "name"));
  if (!name.success) return fail(name.error.issues[0]!.message);
  const id = str(form, "id");
  const type = ctx.types.find((t) => t.id === id);
  const subtype = ctx.types.flatMap((t) => t.subtypes).find((s) => s.id === id);
  const siblings = type ? ctx.types : (ctx.types.find((t) => t.id === subtype?.typeId)?.subtypes ?? []);
  if (taken(siblings, name.data, id)) return fail(`"${name.data}" already exists.`);
  try {
    if (type) await db.issueType.update({ where: { id }, data: { name: name.data } });
    else if (subtype) await db.issueSubtype.update({ where: { id }, data: { name: name.data } });
    else return fail("Type not found.");
  } catch (e) {
    if (unique(e)) return fail(`"${name.data}" already exists.`);
    throw e;
  }
  await audit(ctx, "issue_type.renamed", { id, from: (type ?? subtype)!.name, name: name.data });
  refresh(projectId);
  return ok("Renamed.");
}

/** Deactivated types and subtypes stay on existing issues but can't be chosen for new ones. */
export async function setTypeActive(projectId: string, id: string, active: boolean) {
  const ctx = await manager(projectId);
  if (!ctx) return;
  const type = ctx.types.find((t) => t.id === id);
  const subtype = ctx.types.flatMap((t) => t.subtypes).find((s) => s.id === id);
  if (type) await db.issueType.update({ where: { id }, data: { active } });
  else if (subtype) await db.issueSubtype.update({ where: { id }, data: { active } });
  else return;
  await audit(ctx, active ? "issue_type.activated" : "issue_type.deactivated", { id, name: (type ?? subtype)!.name });
  refresh(projectId);
}

export async function addRootCause(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await manager(projectId);
  if (!ctx) return fail(NOT_MANAGER);
  const name = nameSchema.safeParse(str(form, "name"));
  if (!name.success) return fail(name.error.issues[0]!.message);
  if (taken(ctx.rootCauses, name.data)) return fail(`"${name.data}" already exists.`);
  try {
    const r = await db.issueRootCause.create({ data: { projectId, name: name.data } });
    await audit(ctx, "issue_root_cause.created", { rootCauseId: r.id, name: r.name });
  } catch (e) {
    if (unique(e)) return fail(`"${name.data}" already exists.`);
    throw e;
  }
  refresh(projectId);
  return ok(`Added ${name.data}.`);
}

export async function deleteRootCause(projectId: string, id: string) {
  const ctx = await manager(projectId);
  const r = ctx?.rootCauses.find((x) => x.id === id);
  if (!ctx || !r) return;
  await db.issueRootCause.delete({ where: { id } });
  await audit(ctx, "issue_root_cause.deleted", { rootCauseId: id, name: r.name });
  refresh(projectId);
}

const attributeSchema = z.object({ name: nameSchema, kind: z.enum(["TEXT", "NUMBER", "DATE", "LIST"]) });

export async function addAttribute(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await manager(projectId);
  if (!ctx) return fail(NOT_MANAGER);
  const parsed = attributeSchema.safeParse({ name: str(form, "name"), kind: str(form, "kind") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid attribute");
  const options = parsed.data.kind === "LIST" ? parseOptions(str(form, "options")) : [];
  if (parsed.data.kind === "LIST" && options.length === 0) return fail("A list attribute needs at least one option.");
  if (taken(ctx.attributes, parsed.data.name)) return fail(`There is already an attribute called "${parsed.data.name}".`);
  if (ctx.attributes.length >= 30) return fail("A project can have up to 30 custom attributes.");
  try {
    const a = await db.issueAttribute.create({ data: { projectId, name: parsed.data.name, kind: parsed.data.kind, options } });
    await audit(ctx, "issue_attribute.created", { attributeId: a.id, name: a.name, kind: a.kind });
  } catch (e) {
    if (unique(e)) return fail(`There is already an attribute called "${parsed.data.name}".`);
    throw e;
  }
  refresh(projectId);
  return ok(`Added ${parsed.data.name}.`);
}

/** Removes the attribute definition; values stay in the issue's JSON but are no longer shown. */
export async function deleteAttribute(projectId: string, id: string) {
  const ctx = await manager(projectId);
  const a = ctx?.attributes.find((x) => x.id === id);
  if (!ctx || !a) return;
  await db.issueAttribute.delete({ where: { id } });
  await audit(ctx, "issue_attribute.deleted", { attributeId: id, name: a.name });
  refresh(projectId);
}

export async function addLocation(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await manager(projectId);
  if (!ctx) return fail(NOT_MANAGER);
  const name = nameSchema.safeParse(str(form, "name"));
  if (!name.success) return fail(name.error.issues[0]!.message);
  const parentId = str(form, "parentId") || null;
  if (parentId && !ctx.locations.some((l) => l.id === parentId)) return fail("Choose a parent from the list.");
  if (ctx.locationPaths.find((l) => l.id === parentId)?.depth === 5) return fail("Locations go up to six levels deep.");
  // Postgres treats NULL parents as distinct, so check top-level duplicates here
  if (ctx.locations.some((l) => l.parentId === parentId && l.name.toLowerCase() === name.data.toLowerCase())) return fail(`"${name.data}" is already there.`);
  if (ctx.locations.length >= 2000) return fail("A project can have up to 2000 locations.");
  try {
    const l = await db.location.create({ data: { projectId, parentId, name: name.data } });
    await audit(ctx, "location.created", { locationId: l.id, name: l.name, parentId });
  } catch (e) {
    if (unique(e)) return fail(`"${name.data}" is already there.`);
    throw e;
  }
  refresh(projectId);
  return ok(`Added ${name.data}.`);
}

/** Deletes a location and the places inside it; issues there lose their location. */
export async function deleteLocation(projectId: string, id: string) {
  const ctx = await manager(projectId);
  const l = ctx?.locations.find((x) => x.id === id);
  if (!ctx || !l) return;
  await db.location.delete({ where: { id } });
  await audit(ctx, "location.deleted", { locationId: id, name: l.name });
  refresh(projectId);
}
