"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";
import { applyAnswer, loadChecklist } from "@/modules/checklists/answer";
import { getChecklistsContext } from "@/modules/checklists/server";
import { completeChecklistPhotoUpload, requestChecklistPhotoUploads } from "@/modules/checklists/media-actions";
import { createIssueFromForm } from "@/modules/issues/form";
import { getIssuesContext } from "@/modules/issues/server";
import { completePhotoUpload, requestPhotoUploads, type PhotoTicket } from "@/modules/issues/media-actions";
import {
  answerChangeSchema,
  answerConflicts,
  basicIssueFields,
  issueChangeSchema,
  issueTitleOf,
  photoChangeSchema,
  type ChangeKind,
  type SyncResult,
} from "./logic";

// Changes made offline arrive here when the device is back online. Each one goes through the
// same checks as the online action (access, validation, AuditEvent), and is recorded in the
// OfflineChange ledger under the device's id for it, so a change sent twice is applied once.

type Ctx = Awaited<ReturnType<typeof getProjectContext>>;

async function prior(ctx: Ctx, clientId: string): Promise<SyncResult | null> {
  const row = await db.offlineChange.findUnique({ where: { clientId } });
  if (!row) return null;
  if (row.userId !== ctx.user.id || row.projectId !== ctx.project.id) return { status: "rejected", message: "This change belongs to someone else." };
  return row.result === "APPLIED" ? { status: "applied", resultId: row.resultId, ...(row.message ? { notice: row.message } : {}) } : null;
}

async function record(ctx: Ctx, c: { clientId: string; kind: ChangeKind; madeAt: string }, r: SyncResult, label: string) {
  if (r.status === "rejected" || r.status === "retry") return;
  const applied = r.status === "applied";
  const message = applied ? (r.notice ?? null) : r.message;
  const data = { result: applied ? ("APPLIED" as const) : ("CONFLICT" as const), resultId: applied ? r.resultId : null, message };
  await db.$transaction([
    db.offlineChange.upsert({
      where: { clientId: c.clientId },
      create: { clientId: c.clientId, projectId: ctx.project.id, userId: ctx.user.id, kind: c.kind, madeAt: new Date(c.madeAt), ...data },
      update: data,
    }),
    db.auditEvent.create({
      data: {
        actorId: ctx.user.id,
        projectId: ctx.project.id,
        action: applied ? "offline.synced" : "offline.conflict",
        details: { kind: c.kind, clientId: c.clientId, label, madeAt: c.madeAt, ...(message ? { message } : {}), ...(applied && r.resultId ? { resultId: r.resultId } : {}) },
      },
    }),
  ]);
}

const rejected = (message: string): SyncResult => ({ status: "rejected", message });
const toForm = (fields: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
};

/** An issue created offline. If some of its choices are no longer valid it is still created, without them, with a notice. */
export async function syncIssueCreate(projectId: string, input: unknown): Promise<SyncResult> {
  const parsed = issueChangeSchema.safeParse(input);
  if (!parsed.success) return rejected("This offline issue couldn't be read.");
  const change = parsed.data;
  const ctx = await getIssuesContext(projectId);
  const done = await prior(ctx, change.clientId);
  if (done) return done;
  const title = issueTitleOf(change.fields);
  let result: SyncResult;
  if (!ctx.canCreate) {
    result = { status: "conflict", message: `"${title}" wasn't created: you no longer have Issues Creator access on this project.` };
  } else {
    const full = await createIssueFromForm(ctx, toForm(change.fields));
    if (full.ok) result = { status: "applied", resultId: full.issue.id };
    else {
      // e.g. the chosen assignee left the project while the device was offline: keep the issue, drop the choices
      const basic = await createIssueFromForm(ctx, toForm(basicIssueFields(change.fields)));
      result = basic.ok
        ? { status: "applied", resultId: basic.issue.id, notice: `Issue #${basic.issue.number} "${title}" was created, but some fields couldn't be kept (${full.error}) Check its type, assignee and location.` }
        : { status: "conflict", message: `"${title}" wasn't created: ${basic.error}` };
    }
  }
  await record(ctx, change, result, title);
  if (result.status === "applied") revalidatePath(`/projects/${projectId}/issues`, "layout");
  return result;
}

/**
 * A checklist answer given offline. It is not applied when someone else changed the same item
 * meanwhile, or the checklist was completed; the device then shows a conflict notice. With
 * `force` (the user chose "Use my answer") a changed item is overwritten.
 */
export async function syncChecklistAnswer(projectId: string, input: unknown, force = false): Promise<SyncResult> {
  const parsed = answerChangeSchema.safeParse(input);
  if (!parsed.success) return rejected("This offline answer couldn't be read.");
  const change = parsed.data;
  const ctx = await getChecklistsContext(projectId);
  const done = await prior(ctx, change.clientId);
  if (done) return done;
  const found = await loadChecklist(ctx, change.checklistId);
  const item = found?.checklist.items.find((i) => i.id === change.itemId);
  let result: SyncResult;
  if (!found?.access.see || !item) result = { status: "conflict", message: "The checklist or item was deleted, so this answer wasn't saved." };
  else if (found.checklist.status === "COMPLETED") result = { status: "conflict", message: `CL-${found.checklist.number} was completed before this answer synced, so it wasn't saved. Reopen the checklist to change it.` };
  else if (!force && answerConflicts(change.base, item, change)) {
    const by = item.answeredById ? await db.user.findUnique({ where: { id: item.answeredById }, select: { name: true } }) : null;
    result = {
      status: "conflict",
      message: `Someone else answered "${item.label}" while you were offline.`,
      theirs: { value: item.kind === "SIGNATURE" && item.value ? "(signature)" : item.value, note: item.note, by: by?.name ?? null, at: item.answeredAt?.toISOString() ?? null },
    };
  } else {
    const r = await applyAnswer(ctx, found, item.id, change.value, change.note, { offline: "true", madeAt: change.madeAt });
    result = r.ok ? { status: "applied", resultId: item.id } : { status: "conflict", message: r.error };
  }
  await record(ctx, change, result, item?.label ?? "Checklist answer");
  if (result.status === "applied") revalidatePath(`/projects/${projectId}/checklists`, "layout");
  return result;
}

export type OfflinePhotoStart = { status: "upload"; ticket: PhotoTicket } | SyncResult;

async function photoIssueId(ctx: Ctx, target: { type: string; issueId?: string; issueClientId?: string }) {
  if (target.type === "issue") return target.issueId ?? null;
  if (target.type !== "offline-issue" || !target.issueClientId) return null;
  const row = await db.offlineChange.findUnique({ where: { clientId: target.issueClientId } });
  return row && row.userId === ctx.user.id && row.result === "APPLIED" ? row.resultId : null;
}

/** Step 1 for a photo taken offline: presigned upload URLs, as for a photo taken online. */
export async function startOfflinePhoto(projectId: string, input: unknown): Promise<OfflinePhotoStart> {
  const parsed = photoChangeSchema.safeParse(input);
  if (!parsed.success) return rejected("This offline photo couldn't be read.");
  const change = parsed.data;
  const ctx = await getProjectContext(projectId);
  const done = await prior(ctx, change.clientId);
  if (done) return done;
  const spec = [{ name: change.name, size: change.size, thumbSize: change.thumbSize }];
  const t = change.target;
  let res: Awaited<ReturnType<typeof requestPhotoUploads>>;
  if (t.type === "checklist") res = await requestChecklistPhotoUploads(projectId, t.checklistId, t.itemId, spec);
  else if (t.type === "project") res = await requestPhotoUploads(projectId, null, spec);
  else {
    const issueId = await photoIssueId(ctx, t);
    if (!issueId) {
      // the issue it belongs to hasn't synced yet: try again later
      if (t.type === "offline-issue" && !(await db.offlineChange.findUnique({ where: { clientId: t.issueClientId } }))) return { status: "retry", message: "Waiting for its issue to sync." };
      res = { ok: false, error: "The issue this photo belongs to wasn't created." };
    } else res = await requestPhotoUploads(projectId, issueId, spec);
  }
  if (res.ok) return { status: "upload", ticket: res.tickets[0] };
  const result: SyncResult = { status: "conflict", message: `Photo "${change.name}" wasn't added: ${res.error}` };
  await record(ctx, change, result, change.name);
  return result;
}

/** Step 2: the photo and thumbnail are uploaded; record the photo. */
export async function finishOfflinePhoto(projectId: string, input: unknown, token: string): Promise<SyncResult> {
  const parsed = photoChangeSchema.safeParse(input);
  if (!parsed.success || typeof token !== "string") return rejected("This offline photo couldn't be read.");
  const change = parsed.data;
  const ctx = await getProjectContext(projectId);
  const done = await prior(ctx, change.clientId);
  if (done) return done;
  const r = change.target.type === "checklist" ? await completeChecklistPhotoUpload(projectId, token, change.caption) : await completePhotoUpload(projectId, token, change.caption);
  const result: SyncResult = r.ok ? { status: "applied", resultId: r.id } : { status: "conflict", message: `Photo "${change.name}" wasn't added: ${r.error}` };
  await record(ctx, change, result, change.name);
  return result;
}
