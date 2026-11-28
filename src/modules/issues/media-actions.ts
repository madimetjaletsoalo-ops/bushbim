"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getStorage, type PresignedPut } from "@/lib/storage";
import { photoClaims, secretBytes, signToken, verifyToken } from "@/modules/docs/token";
import { issueLabel } from "./logic";
import { MAX_CAPTION, MAX_PHOTOS_PER_UPLOAD, canDeletePhoto, photoFileName, photoKeys, photoSpec, pinSchema } from "./media";
import { canAddProjectPhotos, photoAccess, pinTarget, verifyUploadedPhoto } from "./media-server";
import { accessFor, getIssuesContext, type IssuesContext } from "./server";

// Pins: placing, moving or removing an issue's pin needs edit rights on the issue
// (its creator at Creator level, or a Manager) and View on the sheet's folder.
// Photos: on an issue, anyone who can see it and is a Creator or its assignee;
// project photos, Issues or Document Control Creators. The uploader or a Manager deletes.
// Every mutation writes an AuditEvent.

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const idSchema = z.string().min(1).max(64);
const PHOTO_TOKEN_TTL = 60 * 60;

const refresh = (projectId: string, issueId?: string | null) => {
  revalidatePath(`/projects/${projectId}/issues`, "layout");
  revalidatePath(`/projects/${projectId}/docs/photos`);
  if (issueId) revalidatePath(`/projects/${projectId}/issues/${issueId}`);
};

async function loadIssue(ctx: IssuesContext, issueId: unknown) {
  if (!idSchema.safeParse(issueId).success) return null;
  const issue = await db.issue.findFirst({ where: { id: issueId as string, projectId: ctx.project.id }, include: { status: true, pin: true } });
  return issue ? { issue, access: accessFor(ctx, issue) } : null;
}

// ---------- pins ----------

export type PinDTO = { issueId: string; versionId: string; page: number; x: number; y: number };

/** Pins an issue on a page of a document version, or moves its pin there (one pin per issue). */
export async function placePin(projectId: string, issueId: string, input: unknown): Promise<Result<PinDTO>> {
  const ctx = await getIssuesContext(projectId);
  const found = await loadIssue(ctx, issueId);
  if (!found?.access.see) return { ok: false, error: "Issue not found." };
  if (!found.access.edit) return { ok: false, error: ctx.level === "CREATOR" ? "Creators can pin only the issues they created." : "You can't pin this issue." };
  const parsed = pinSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That pin position is invalid." };
  const target = await pinTarget(projectId, parsed.data.versionId);
  if (!target) return { ok: false, error: "You can't open this sheet." };
  const { versionId, page } = parsed.data;
  const x = Math.round(parsed.data.x * 100) / 100;
  const y = Math.round(parsed.data.y * 100) / 100;
  const { issue } = found;
  await db.$transaction([
    db.issuePin.upsert({
      where: { issueId: issue.id },
      create: { issueId: issue.id, versionId, page, x, y, createdById: ctx.user.id },
      update: { versionId, page, x, y },
    }),
    db.auditEvent.create({
      data: {
        actorId: ctx.user.id,
        projectId,
        action: "issue.pinned",
        details: { issueId: issue.id, number: issue.number, versionId, document: target.document.name, page, moved: !!issue.pin },
      },
    }),
  ]);
  refresh(projectId, issue.id);
  return { ok: true, data: { issueId: issue.id, versionId, page, x, y } };
}

export async function removePin(projectId: string, issueId: string) {
  const ctx = await getIssuesContext(projectId);
  const found = await loadIssue(ctx, issueId);
  if (!found?.access.edit || !found.issue.pin) return;
  const { issue } = found;
  await db.$transaction([
    db.issuePin.delete({ where: { issueId: issue.id } }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "issue.unpinned", details: { issueId: issue.id, number: issue.number } } }),
  ]);
  refresh(projectId, issue.id);
}

// ---------- photos ----------

export type PhotoTicket = { main: PresignedPut; thumb: PresignedPut; token: string; name: string };
export type RequestPhotosResult = { ok: true; tickets: PhotoTicket[] } | { ok: false; error: string };

/** Whether the member may add photos to this issue (or, with no issue, to the project). */
async function photoTarget(ctx: IssuesContext, issueId: string | null) {
  if (!issueId) return canAddProjectPhotos(ctx) ? { issue: null } : null;
  const found = await loadIssue(ctx, issueId);
  if (!found?.access.see) return null;
  if (!(ctx.canCreate || found.access.status)) return null;
  return { issue: found.issue };
}

/** Step 1: the browser has compressed the photos; it asks for presigned upload URLs for each photo and thumbnail. */
export async function requestPhotoUploads(projectId: string, issueId: string | null, files: unknown): Promise<RequestPhotosResult> {
  const ctx = await getIssuesContext(projectId);
  if (issueId !== null && !idSchema.safeParse(issueId).success) return { ok: false, error: "Issue not found." };
  const target = await photoTarget(ctx, issueId);
  if (!target) return { ok: false, error: issueId ? "You can't add photos to this issue." : "Adding photos needs Creator access." };
  const parsed = z.array(photoSpec).min(1).max(MAX_PHOTOS_PER_UPLOAD, `Add up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time.`).safeParse(files);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid photos" };
  const storage = getStorage();
  const tickets: PhotoTicket[] = [];
  for (const f of parsed.data) {
    const { key, thumbKey } = photoKeys(projectId, randomBytes(16).toString("hex"));
    const name = photoFileName(f.name);
    const [main, thumb] = await Promise.all([storage.presignPut(key, "image/jpeg", f.size), storage.presignPut(thumbKey, "image/jpeg", f.thumbSize)]);
    const token = await signToken(
      { typ: "photo", pid: projectId, iid: issueId ?? "", uid: ctx.user.id, key, tkey: thumbKey, name, size: f.size, tsize: f.thumbSize },
      secretBytes(),
      PHOTO_TOKEN_TTL,
    );
    tickets.push({ main, thumb, token, name });
  }
  return { ok: true, tickets };
}

export type CompletePhotoResult = { ok: true; id: string } | { ok: false; error: string };

/** Step 2: checks the stored files really are JPEGs within the size limits, then records the photo. */
export async function completePhotoUpload(projectId: string, token: string, caption?: string): Promise<CompletePhotoResult> {
  const c = typeof token === "string" ? await verifyToken(token, photoClaims, secretBytes()) : null;
  if (!c || c.pid !== projectId) return { ok: false, error: "Upload link is invalid or has expired. Try again." };
  const ctx = await getIssuesContext(projectId);
  if (c.uid !== ctx.user.id) return { ok: false, error: "Upload link is invalid or has expired. Try again." };
  // access may have changed while the photo uploaded
  const target = await photoTarget(ctx, c.iid || null);
  if (!target) return { ok: false, error: "You can no longer add photos here." };
  if (await db.photo.findUnique({ where: { storageKey: c.key } })) return { ok: false, error: "This photo was already saved." };
  const checked = await verifyUploadedPhoto(c);
  if (!checked.ok) return checked;
  const { size, dims } = checked;
  const text = (caption ?? "").trim().slice(0, MAX_CAPTION) || null;
  const issue = target.issue;
  const photo = await db.$transaction(async (tx) => {
    const p = await tx.photo.create({
      data: { projectId, issueId: issue?.id ?? null, storageKey: c.key, thumbKey: c.tkey, fileName: c.name, width: dims.width, height: dims.height, size, caption: text, uploadedById: ctx.user.id },
    });
    await tx.auditEvent.create({
      data: {
        actorId: ctx.user.id,
        projectId,
        action: issue ? "issue.photo_added" : "photo.added",
        details: { photoId: p.id, name: p.fileName, ...(issue ? { issueId: issue.id, number: issue.number, label: issueLabel(issue.number) } : {}) },
      },
    });
    return p;
  });
  refresh(projectId, issue?.id);
  return { ok: true, id: photo.id };
}

export async function deletePhoto(projectId: string, photoId: string) {
  const ctx = await getIssuesContext(projectId);
  const found = await photoAccess(ctx, photoId);
  if (!found || found.photo.checklistItemId || found.photo.dailyLogId || !canDeletePhoto(found.photo, ctx.user.id, found.manager)) return;
  const { photo } = found;
  await db.$transaction([
    db.photo.delete({ where: { id: photo.id } }),
    db.auditEvent.create({
      data: {
        actorId: ctx.user.id,
        projectId,
        action: photo.issue ? "issue.photo_deleted" : "photo.deleted",
        details: { photoId: photo.id, name: photo.fileName, ...(photo.issue ? { issueId: photo.issue.id, number: photo.issue.number } : {}) },
      },
    }),
  ]);
  try {
    await getStorage().remove([photo.storageKey, photo.thumbKey]);
  } catch (e) {
    console.error("photos: failed to remove stored files", e);
  }
  refresh(projectId, photo.issueId);
}
