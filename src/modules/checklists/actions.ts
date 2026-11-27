"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import type { ActionState } from "@/modules/admin/types";
import { issueLabel } from "@/modules/issues/logic";
import { createIssueRow, getIssuesContext } from "@/modules/issues/server";
import {
  LIMITS,
  checklistDetailsSchema,
  checklistLabel,
  isFailed,
  issueFromItem,
  moveInList,
  parseChecklistAssignee,
  progress,
  sectionTitleSchema,
  templateItemSchema,
  templateNameSchema,
} from "./logic";
import { createChecklistRow, getChecklistsContext, type ChecklistsContext } from "./server";
import { applyAnswer, loadChecklist } from "./answer";
import { actorOf, checklistAssigned } from "@/modules/notifications/events";

// Access rules live in logic.ts (checklistAccess). Every action re-checks them and writes an AuditEvent.

const fail = (error: string): ActionState => ({ ok: false, error });
const ok = (message: string): ActionState => ({ ok: true, message });
const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};
const idSchema = z.string().min(1).max(64);
const unique = (e: unknown) => typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
const refresh = (projectId: string) => revalidatePath(`/projects/${projectId}/checklists`, "layout");
const audit = (ctx: ChecklistsContext, action: string, details: Prisma.InputJsonValue) =>
  db.auditEvent.create({ data: { actorId: ctx.user.id, projectId: ctx.project.id, action, details } });

// ---------- templates (Checklists Managers) ----------

const NOT_MANAGER = "Building checklist templates needs Checklists Manager access.";

async function managerTemplate(projectId: string, templateId: string) {
  const ctx = await getChecklistsContext(projectId);
  if (!ctx.canManage || !idSchema.safeParse(templateId).success) return null;
  const template = await db.checklistTemplate.findFirst({
    where: { id: templateId, projectId },
    include: { sections: { orderBy: { order: "asc" }, include: { items: { orderBy: { order: "asc" } } } } },
  });
  return template ? { ctx, template } : null;
}

export async function createTemplate(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getChecklistsContext(projectId);
  if (!ctx.canManage) return fail(NOT_MANAGER);
  const name = templateNameSchema.safeParse(str(form, "name"));
  if (!name.success) return fail(name.error.issues[0]!.message);
  const description = str(form, "description").trim().slice(0, 500) || null;
  if ((await db.checklistTemplate.count({ where: { projectId } })) >= LIMITS.templatesPerProject) return fail(`A project can have up to ${LIMITS.templatesPerProject} templates.`);
  const clash = await db.checklistTemplate.findFirst({ where: { projectId, name: { equals: name.data, mode: "insensitive" } } });
  if (clash) return fail(`There is already a template called "${clash.name}".`);
  let id: string;
  try {
    const t = await db.checklistTemplate.create({
      data: { projectId, name: name.data, description, createdById: ctx.user.id, sections: { create: { title: "General", order: 0 } } },
    });
    id = t.id;
    await audit(ctx, "checklist_template.created", { templateId: t.id, name: t.name });
  } catch (e) {
    if (unique(e)) return fail(`There is already a template called "${name.data}".`);
    throw e;
  }
  refresh(projectId);
  redirect(`/projects/${projectId}/checklists/templates/${id}`);
}

export async function updateTemplate(projectId: string, templateId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const found = await managerTemplate(projectId, templateId);
  if (!found) return fail(NOT_MANAGER);
  const { ctx, template } = found;
  const name = templateNameSchema.safeParse(str(form, "name"));
  if (!name.success) return fail(name.error.issues[0]!.message);
  const description = str(form, "description").trim().slice(0, 500) || null;
  const clash = await db.checklistTemplate.findFirst({ where: { projectId, id: { not: template.id }, name: { equals: name.data, mode: "insensitive" } } });
  if (clash) return fail(`There is already a template called "${clash.name}".`);
  try {
    await db.checklistTemplate.update({ where: { id: template.id }, data: { name: name.data, description } });
  } catch (e) {
    if (unique(e)) return fail(`There is already a template called "${name.data}".`);
    throw e;
  }
  await audit(ctx, "checklist_template.updated", { templateId: template.id, from: template.name, name: name.data });
  refresh(projectId);
  return ok("Template saved.");
}

/** Archived templates stay on the checklists made from them but can't be used for new ones. */
export async function setTemplateArchived(projectId: string, templateId: string, archived: boolean) {
  const found = await managerTemplate(projectId, templateId);
  if (!found) return;
  await db.checklistTemplate.update({ where: { id: templateId }, data: { archived } });
  await audit(found.ctx, archived ? "checklist_template.archived" : "checklist_template.restored", { templateId, name: found.template.name });
  refresh(projectId);
}

export async function addSection(projectId: string, templateId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const found = await managerTemplate(projectId, templateId);
  if (!found) return fail(NOT_MANAGER);
  const { ctx, template } = found;
  const title = sectionTitleSchema.safeParse(str(form, "title"));
  if (!title.success) return fail(title.error.issues[0]!.message);
  if (template.sections.length >= LIMITS.sectionsPerTemplate) return fail(`A template can have up to ${LIMITS.sectionsPerTemplate} sections.`);
  const order = template.sections.reduce((m, s) => Math.max(m, s.order), -1) + 1;
  const s = await db.checklistTemplateSection.create({ data: { templateId, title: title.data, order } });
  await audit(ctx, "checklist_template.section_added", { templateId, sectionId: s.id, template: template.name, title: s.title });
  refresh(projectId);
  return ok(`Added section ${s.title}.`);
}

export async function renameSection(projectId: string, templateId: string, sectionId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const found = await managerTemplate(projectId, templateId);
  if (!found) return fail(NOT_MANAGER);
  const section = found.template.sections.find((s) => s.id === sectionId);
  if (!section) return fail("Section not found.");
  const title = sectionTitleSchema.safeParse(str(form, "title"));
  if (!title.success) return fail(title.error.issues[0]!.message);
  if (title.data === section.title) return ok("No changes.");
  await db.checklistTemplateSection.update({ where: { id: sectionId }, data: { title: title.data } });
  await audit(found.ctx, "checklist_template.section_renamed", { templateId, sectionId, from: section.title, title: title.data });
  refresh(projectId);
  return ok("Section renamed.");
}

export async function deleteSection(projectId: string, templateId: string, sectionId: string) {
  const found = await managerTemplate(projectId, templateId);
  const section = found?.template.sections.find((s) => s.id === sectionId);
  if (!found || !section) return;
  await db.checklistTemplateSection.delete({ where: { id: sectionId } });
  await audit(found.ctx, "checklist_template.section_deleted", { templateId, sectionId, title: section.title, items: section.items.length });
  refresh(projectId);
}

export async function moveSection(projectId: string, templateId: string, sectionId: string, dir: "up" | "down") {
  const found = await managerTemplate(projectId, templateId);
  if (!found) return;
  const order = moveInList(found.template.sections.map((s) => s.id), sectionId, dir);
  if (!order) return;
  await db.$transaction(order.map((id, n) => db.checklistTemplateSection.update({ where: { id }, data: { order: n } })));
  await audit(found.ctx, "checklist_template.section_moved", { templateId, sectionId, dir });
  refresh(projectId);
}

function readItem(form: FormData) {
  return templateItemSchema.safeParse({ label: str(form, "label"), kind: str(form, "kind"), required: form.get("required") === "on" });
}

export async function addItem(projectId: string, templateId: string, sectionId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const found = await managerTemplate(projectId, templateId);
  if (!found) return fail(NOT_MANAGER);
  const { ctx, template } = found;
  const section = template.sections.find((s) => s.id === sectionId);
  if (!section) return fail("Section not found.");
  const parsed = readItem(form);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid item");
  if (section.items.length >= LIMITS.itemsPerSection) return fail(`A section can have up to ${LIMITS.itemsPerSection} items.`);
  if (template.sections.reduce((n, s) => n + s.items.length, 0) >= LIMITS.itemsPerTemplate) return fail(`A template can have up to ${LIMITS.itemsPerTemplate} items.`);
  const order = section.items.reduce((m, i) => Math.max(m, i.order), -1) + 1;
  const item = await db.checklistTemplateItem.create({ data: { sectionId, ...parsed.data, order } });
  await audit(ctx, "checklist_template.item_added", { templateId, sectionId, itemId: item.id, label: item.label, kind: item.kind });
  refresh(projectId);
  return ok("Item added.");
}

export async function updateItem(projectId: string, templateId: string, itemId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const found = await managerTemplate(projectId, templateId);
  if (!found) return fail(NOT_MANAGER);
  const item = found.template.sections.flatMap((s) => s.items).find((i) => i.id === itemId);
  if (!item) return fail("Item not found.");
  const parsed = readItem(form);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid item");
  const d = parsed.data;
  if (d.label === item.label && d.kind === item.kind && d.required === item.required) return ok("No changes.");
  await db.checklistTemplateItem.update({ where: { id: itemId }, data: d });
  await audit(found.ctx, "checklist_template.item_updated", { templateId, itemId, from: item.label, label: d.label, kind: d.kind, required: d.required });
  refresh(projectId);
  return ok("Item saved.");
}

export async function deleteItem(projectId: string, templateId: string, itemId: string) {
  const found = await managerTemplate(projectId, templateId);
  const item = found?.template.sections.flatMap((s) => s.items).find((i) => i.id === itemId);
  if (!found || !item) return;
  await db.checklistTemplateItem.delete({ where: { id: itemId } });
  await audit(found.ctx, "checklist_template.item_deleted", { templateId, itemId, label: item.label });
  refresh(projectId);
}

export async function moveItem(projectId: string, templateId: string, itemId: string, dir: "up" | "down") {
  const found = await managerTemplate(projectId, templateId);
  const section = found?.template.sections.find((s) => s.items.some((i) => i.id === itemId));
  if (!found || !section) return;
  const order = moveInList(section.items.map((i) => i.id), itemId, dir);
  if (!order) return;
  await db.$transaction(order.map((id, n) => db.checklistTemplateItem.update({ where: { id }, data: { order: n } })));
  await audit(found.ctx, "checklist_template.item_moved", { templateId, itemId, dir });
  refresh(projectId);
}

// ---------- checklists ----------

type Details = { title: string; assigneeType: "USER" | "COMPANY" | null; assigneeId: string | null; locationId: string | null; dueDate: Date | null };

function resolveDetails(ctx: ChecklistsContext, form: FormData): Details | { error: string } {
  const parsed = checklistDetailsSchema.safeParse({ title: str(form, "title"), assignee: str(form, "assignee"), locationId: str(form, "locationId"), dueDate: str(form, "dueDate") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;
  const assignee = v.assignee ? parseChecklistAssignee(v.assignee) : null;
  if (v.assignee && (!assignee || !ctx.isAssignee(v.assignee))) return { error: "Assign the checklist to a project member or a company." };
  if (v.locationId && !ctx.locations.some((l) => l.id === v.locationId)) return { error: "Choose a location from the list." };
  return { title: v.title, assigneeType: assignee?.type ?? null, assigneeId: assignee?.id ?? null, locationId: v.locationId, dueDate: v.dueDate };
}

export async function createChecklist(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getChecklistsContext(projectId);
  if (!ctx.canCreate) return fail("Creating checklists needs Checklists Creator access.");
  const templateId = str(form, "templateId");
  const template = idSchema.safeParse(templateId).success
    ? await db.checklistTemplate.findFirst({
        where: { id: templateId, projectId, archived: false },
        include: { sections: { orderBy: { order: "asc" }, include: { items: { orderBy: { order: "asc" } } } } },
      })
    : null;
  if (!template) return fail("Choose a template from the list.");
  if (!template.sections.some((s) => s.items.length)) return fail("That template has no items yet.");
  if (!str(form, "title").trim()) form.set("title", template.name);
  const d = resolveDetails(ctx, form);
  if ("error" in d) return fail(d.error);
  const checklist = await createChecklistRow(
    { projectId, ...d, templateId: template.id, templateName: template.name, createdById: ctx.user.id },
    template.sections.filter((s) => s.items.length).map((s) => ({ title: s.title, items: s.items.map((i) => ({ label: i.label, kind: i.kind, required: i.required })) })),
    ctx.user.id,
  );
  await checklistAssigned(actorOf(ctx), { id: checklist.id, number: checklist.number, title: d.title, assigneeType: d.assigneeType, assigneeId: d.assigneeId });
  refresh(projectId);
  redirect(`/projects/${projectId}/checklists/${checklist.id}`);
}

export async function updateChecklistDetails(projectId: string, checklistId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getChecklistsContext(projectId);
  const found = await loadChecklist(ctx, checklistId);
  if (!found?.access.see) return fail("Checklist not found.");
  if (!found.access.edit) return fail(ctx.level === "CREATOR" ? "Creators can edit only the checklists they created." : "You can't edit this checklist.");
  const d = resolveDetails(ctx, form);
  if ("error" in d) return fail(d.error);
  const c = found.checklist;
  const changed = (Object.keys(d) as (keyof Details)[]).filter((k) => String(d[k] instanceof Date ? (d[k] as Date).toISOString() : d[k]) !== String(c[k] instanceof Date ? (c[k] as Date).toISOString() : c[k]));
  if (!changed.length) return ok("No changes.");
  await db.$transaction([
    db.checklist.update({ where: { id: c.id }, data: d }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "checklist.updated", details: { checklistId: c.id, number: c.number, fields: changed } } }),
  ]);
  if (d.assigneeType && (d.assigneeType !== c.assigneeType || d.assigneeId !== c.assigneeId))
    await checklistAssigned(actorOf(ctx), { id: c.id, number: c.number, title: d.title, assigneeType: d.assigneeType, assigneeId: d.assigneeId });
  refresh(projectId);
  return ok("Checklist saved.");
}

/** Answers (or clears) one item. A blank value clears the answer. */
export async function answerItem(projectId: string, checklistId: string, itemId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getChecklistsContext(projectId);
  const found = await loadChecklist(ctx, checklistId);
  const r = await applyAnswer(ctx, found, itemId, str(form, "value"), form.has("note") ? str(form, "note") : undefined);
  if (!r.ok) return fail(r.error);
  if (r.changed) refresh(projectId);
  return ok(r.message);
}

export async function completeChecklist(projectId: string, checklistId: string): Promise<ActionState> {
  const ctx = await getChecklistsContext(projectId);
  const found = await loadChecklist(ctx, checklistId);
  if (!found?.access.see) return fail("Checklist not found.");
  if (!found.access.complete)
    return fail(found.checklist.status === "COMPLETED" ? "This checklist is already completed." : "Only the assignee, the checklist's creator or a Checklists Manager can complete it.");
  const c = found.checklist;
  const p = progress(c.items.map((i) => ({ ...i, photoCount: i._count.photos })));
  if (p.missing.length)
    return { ok: false, error: `Answer the required items first (${p.missing.length} left).`, details: p.missing.slice(0, 10).map((i) => `${i.section.title}: ${i.label}`) };
  const now = new Date();
  await db.$transaction([
    db.checklist.update({ where: { id: c.id }, data: { status: "COMPLETED", completedAt: now, completedById: ctx.user.id } }),
    db.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "checklist.completed", details: { checklistId: c.id, number: c.number, answered: p.answered, total: p.total, failed: p.failed } },
    }),
  ]);
  refresh(projectId);
  return ok(`${checklistLabel(c.number)} completed.`);
}

export async function reopenChecklist(projectId: string, checklistId: string) {
  const ctx = await getChecklistsContext(projectId);
  const found = await loadChecklist(ctx, checklistId);
  if (!found?.access.reopen) return;
  const c = found.checklist;
  await db.$transaction([
    db.checklist.update({ where: { id: c.id }, data: { status: "IN_PROGRESS", completedAt: null, completedById: null } }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "checklist.reopened", details: { checklistId: c.id, number: c.number } } }),
  ]);
  refresh(projectId);
}

/** Deletes a checklist with its answers and photos (Managers only). Issues raised from it stay. */
export async function deleteChecklist(projectId: string, checklistId: string) {
  const ctx = await getChecklistsContext(projectId);
  const found = await loadChecklist(ctx, checklistId);
  if (!found?.access.delete) return;
  const c = found.checklist;
  const photos = await db.photo.findMany({ where: { checklistItem: { checklistId: c.id } }, select: { storageKey: true, thumbKey: true } });
  await db.$transaction([
    db.checklist.delete({ where: { id: c.id } }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "checklist.deleted", details: { checklistId: c.id, number: c.number, title: c.title, photos: photos.length } } }),
  ]);
  if (photos.length) {
    try {
      await getStorage().remove(photos.flatMap((p) => [p.storageKey, p.thumbKey]));
    } catch (e) {
      console.error("checklists: failed to remove stored photos", e);
    }
  }
  refresh(projectId);
  redirect(`/projects/${projectId}/checklists`);
}

/**
 * One click on a failed item raises an issue: titled after the item, at the checklist's
 * location, assigned like the checklist, in the project's default status. Needs Issues Creator.
 */
export async function raiseIssueFromItem(projectId: string, checklistId: string, itemId: string): Promise<ActionState> {
  const ctx = await getChecklistsContext(projectId);
  const found = await loadChecklist(ctx, checklistId);
  if (!found?.access.see) return fail("Checklist not found.");
  if (!ctx.canRaiseIssues) return fail("Raising issues needs Issues Creator access.");
  const c = found.checklist;
  const item = c.items.find((i) => i.id === itemId);
  if (!item) return fail("Item not found.");
  if (!isFailed(item)) return fail("Only items answered No can raise an issue.");
  if (item.issueId) return fail("An issue was already raised for this item.");
  const issues = await getIssuesContext(projectId);
  const status = issues.statuses.find((s) => s.isDefault) ?? issues.statuses.find((s) => !s.draft && !s.closed);
  if (!status) return fail("This project has no issue statuses. Ask an Issues Manager to add one.");
  // the checklist's location may have been deleted since; the assignee must still be valid for issues
  const locationId = c.locationId && issues.locations.some((l) => l.id === c.locationId) ? c.locationId : null;
  const assignee = c.assigneeType && c.assigneeId && issues.isAssignee(`${c.assigneeType}:${c.assigneeId}`) ? { assigneeType: c.assigneeType, assigneeId: c.assigneeId } : {};
  const { title, description } = issueFromItem(c, item.section.title, item);
  const issue = await createIssueRow(
    { projectId, title, description, statusId: status.id, locationId, ...assignee, createdById: ctx.user.id, closedAt: status.closed ? new Date() : null },
    [ctx.user.id],
    ctx.user.id,
  );
  const linked = await db.checklistItem.updateMany({ where: { id: item.id, issueId: null }, data: { issueId: issue.id } });
  if (!linked.count) {
    // a second click linked its issue first: drop this duplicate
    await db.issue.delete({ where: { id: issue.id } });
    return fail("An issue was already raised for this item.");
  }
  await audit(ctx, "checklist.issue_raised", { checklistId: c.id, number: c.number, itemId: item.id, item: item.label, issueId: issue.id, issue: issueLabel(issue.number) });
  refresh(projectId);
  revalidatePath(`/projects/${projectId}/issues`, "layout");
  return ok(`Raised issue ${issueLabel(issue.number)}.`);
}
