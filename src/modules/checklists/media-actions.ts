"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { checklistPhotoClaims, secretBytes, signToken, verifyToken } from "@/modules/docs/token";
import { MAX_CAPTION, MAX_PHOTOS_PER_UPLOAD, photoFileName, photoKeys, photoSpec } from "@/modules/issues/media";
import { verifyUploadedPhoto } from "@/modules/issues/media-server";
import type { CompletePhotoResult, RequestPhotosResult } from "@/modules/issues/media-actions";
import { statusAfterAnswer } from "./logic";
import { accessFor, getChecklistsContext, type ChecklistsContext } from "./server";

// Photos answering a checklist's photo items. Same pipeline as issue photos: compressed in the
// browser to a JPEG ≤ 1600 px wide, PUT to presigned URLs, then verified here before the row is
// written. Adding or removing one needs answer rights on the checklist (it must not be completed).

const idSchema = z.string().min(1).max(64);
const PHOTO_TOKEN_TTL = 60 * 60;

const refresh = (projectId: string) => {
  revalidatePath(`/projects/${projectId}/checklists`, "layout");
  revalidatePath(`/projects/${projectId}/issues/photos`);
  revalidatePath(`/projects/${projectId}/docs/photos`);
};

async function photoItem(ctx: ChecklistsContext, checklistId: unknown, itemId: unknown) {
  if (!idSchema.safeParse(checklistId).success || !idSchema.safeParse(itemId).success) return null;
  const checklist = await db.checklist.findFirst({ where: { id: checklistId as string, projectId: ctx.project.id } });
  if (!checklist) return null;
  const item = await db.checklistItem.findFirst({ where: { id: itemId as string, checklistId: checklist.id, kind: "PHOTO" } });
  if (!item) return null;
  return { checklist, item, access: accessFor(ctx, checklist) };
}

export async function requestChecklistPhotoUploads(projectId: string, checklistId: string, itemId: string, files: unknown): Promise<RequestPhotosResult> {
  const ctx = await getChecklistsContext(projectId);
  const found = await photoItem(ctx, checklistId, itemId);
  if (!found?.access.see) return { ok: false, error: "Checklist item not found." };
  if (!found.access.answer) return { ok: false, error: "You can't add photos to this checklist." };
  const parsed = z.array(photoSpec).min(1).max(MAX_PHOTOS_PER_UPLOAD, `Add up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time.`).safeParse(files);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid photos" };
  const storage = getStorage();
  const tickets = [];
  for (const f of parsed.data) {
    const { key, thumbKey } = photoKeys(projectId, randomBytes(16).toString("hex"));
    const name = photoFileName(f.name);
    const [main, thumb] = await Promise.all([storage.presignPut(key, "image/jpeg", f.size), storage.presignPut(thumbKey, "image/jpeg", f.thumbSize)]);
    const token = await signToken(
      { typ: "checklist_photo", pid: projectId, cid: found.checklist.id, itm: found.item.id, uid: ctx.user.id, key, tkey: thumbKey, name, size: f.size, tsize: f.thumbSize },
      secretBytes(),
      PHOTO_TOKEN_TTL,
    );
    tickets.push({ main, thumb, token, name });
  }
  return { ok: true, tickets };
}

export async function completeChecklistPhotoUpload(projectId: string, token: string, caption?: string): Promise<CompletePhotoResult> {
  const c = typeof token === "string" ? await verifyToken(token, checklistPhotoClaims, secretBytes()) : null;
  if (!c || c.pid !== projectId) return { ok: false, error: "Upload link is invalid or has expired. Try again." };
  const ctx = await getChecklistsContext(projectId);
  if (c.uid !== ctx.user.id) return { ok: false, error: "Upload link is invalid or has expired. Try again." };
  // access may have changed (or the checklist been completed) while the photo uploaded
  const found = await photoItem(ctx, c.cid, c.itm);
  if (!found?.access.answer) return { ok: false, error: "You can no longer add photos to this checklist." };
  if (await db.photo.findUnique({ where: { storageKey: c.key } })) return { ok: false, error: "This photo was already saved." };
  const checked = await verifyUploadedPhoto(c);
  if (!checked.ok) return checked;
  const { checklist, item } = found;
  const text = (caption ?? "").trim().slice(0, MAX_CAPTION) || null;
  const photo = await db.$transaction(async (tx) => {
    const p = await tx.photo.create({
      data: {
        projectId,
        checklistItemId: item.id,
        storageKey: c.key,
        thumbKey: c.tkey,
        fileName: c.name,
        width: checked.dims.width,
        height: checked.dims.height,
        size: checked.size,
        caption: text,
        uploadedById: ctx.user.id,
      },
    });
    await tx.checklistItem.update({ where: { id: item.id }, data: { answeredById: ctx.user.id, answeredAt: new Date() } });
    await tx.checklist.update({ where: { id: checklist.id }, data: { status: statusAfterAnswer(checklist.status) } });
    await tx.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "checklist.photo_added", details: { checklistId: checklist.id, number: checklist.number, itemId: item.id, item: item.label, photoId: p.id, name: p.fileName } },
    });
    return p;
  });
  refresh(projectId);
  return { ok: true, id: photo.id };
}

/** Removes a photo from a checklist item while the checklist is open. */
export async function deleteChecklistPhoto(projectId: string, checklistId: string, photoId: string) {
  const ctx = await getChecklistsContext(projectId);
  if (!idSchema.safeParse(photoId).success) return;
  const photo = await db.photo.findFirst({ where: { id: photoId, projectId, checklistItem: { checklistId } }, include: { checklistItem: true } });
  if (!photo?.checklistItem) return;
  const found = await photoItem(ctx, checklistId, photo.checklistItem.id);
  if (!found?.access.answer) return;
  await db.$transaction([
    db.photo.delete({ where: { id: photo.id } }),
    db.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "checklist.photo_deleted", details: { checklistId, number: found.checklist.number, itemId: found.item.id, item: found.item.label, photoId, name: photo.fileName } },
    }),
  ]);
  try {
    await getStorage().remove([photo.storageKey, photo.thumbKey]);
  } catch (e) {
    console.error("checklists: failed to remove stored photo", e);
  }
  refresh(projectId);
}
