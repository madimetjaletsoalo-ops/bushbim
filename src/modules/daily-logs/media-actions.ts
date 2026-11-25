"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { dailyLogPhotoClaims, secretBytes, signToken, verifyToken } from "@/modules/docs/token";
import { MAX_CAPTION, MAX_PHOTOS_PER_UPLOAD, photoFileName, photoKeys, photoSpec } from "@/modules/issues/media";
import { verifyUploadedPhoto } from "@/modules/issues/media-server";
import type { CompletePhotoResult, RequestPhotosResult } from "@/modules/issues/media-actions";
import { dateToDay } from "./logic";
import { getDailyLogsContext, type DailyLogsContext } from "./server";

// Photos on a daily log. Same pipeline as issue photos: compressed in the browser to a JPEG
// ≤ 1600 px wide, PUT to presigned URLs, then verified here before the row is written.
// Anyone who may contribute to the draft log (Creators, subcontractor members) adds photos;
// the uploader or a Creator removes them while the log is a draft.

const idSchema = z.string().min(1).max(64);
const PHOTO_TOKEN_TTL = 60 * 60;

const refresh = (projectId: string) => {
  revalidatePath(`/projects/${projectId}/daily-logs`, "layout");
  revalidatePath(`/projects/${projectId}/issues/photos`);
  revalidatePath(`/projects/${projectId}/docs/photos`);
};

async function loadLog(ctx: DailyLogsContext, logId: unknown) {
  if (!idSchema.safeParse(logId).success) return null;
  const log = await db.dailyLog.findFirst({ where: { id: logId as string, projectId: ctx.project.id } });
  return log ? { log, access: ctx.accessFor(log) } : null;
}

export async function requestDailyLogPhotoUploads(projectId: string, logId: string, files: unknown): Promise<RequestPhotosResult> {
  const ctx = await getDailyLogsContext(projectId);
  const found = await loadLog(ctx, logId);
  if (!found?.access.see) return { ok: false, error: "Daily log not found." };
  if (!found.access.contribute) return { ok: false, error: found.log.status === "PUBLISHED" ? "This log is published. Reopen it to add photos." : "You can't add photos to this log." };
  const parsed = z.array(photoSpec).min(1).max(MAX_PHOTOS_PER_UPLOAD, `Add up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time.`).safeParse(files);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid photos" };
  const storage = getStorage();
  const tickets = [];
  for (const f of parsed.data) {
    const { key, thumbKey } = photoKeys(projectId, randomBytes(16).toString("hex"));
    const name = photoFileName(f.name);
    const [main, thumb] = await Promise.all([storage.presignPut(key, "image/jpeg", f.size), storage.presignPut(thumbKey, "image/jpeg", f.thumbSize)]);
    const token = await signToken(
      { typ: "daily_log_photo", pid: projectId, lid: found.log.id, uid: ctx.user.id, key, tkey: thumbKey, name, size: f.size, tsize: f.thumbSize },
      secretBytes(),
      PHOTO_TOKEN_TTL,
    );
    tickets.push({ main, thumb, token, name });
  }
  return { ok: true, tickets };
}

export async function completeDailyLogPhotoUpload(projectId: string, token: string, caption?: string): Promise<CompletePhotoResult> {
  const c = typeof token === "string" ? await verifyToken(token, dailyLogPhotoClaims, secretBytes()) : null;
  if (!c || c.pid !== projectId) return { ok: false, error: "Upload link is invalid or has expired. Try again." };
  const ctx = await getDailyLogsContext(projectId);
  if (c.uid !== ctx.user.id) return { ok: false, error: "Upload link is invalid or has expired. Try again." };
  // access may have changed (or the log been published) while the photo uploaded
  const found = await loadLog(ctx, c.lid);
  if (!found?.access.contribute) return { ok: false, error: "You can no longer add photos to this log." };
  if (await db.photo.findUnique({ where: { storageKey: c.key } })) return { ok: false, error: "This photo was already saved." };
  const checked = await verifyUploadedPhoto(c);
  if (!checked.ok) return checked;
  const text = (caption ?? "").trim().slice(0, MAX_CAPTION) || null;
  const photo = await db.$transaction(async (tx) => {
    const p = await tx.photo.create({
      data: {
        projectId,
        dailyLogId: found.log.id,
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
    await tx.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "daily_log.photo_added", details: { logId: found.log.id, date: dateToDay(found.log.date), photoId: p.id, name: p.fileName } },
    });
    return p;
  });
  refresh(projectId);
  return { ok: true, id: photo.id };
}

export async function deleteDailyLogPhoto(projectId: string, logId: string, photoId: string) {
  const ctx = await getDailyLogsContext(projectId);
  if (!idSchema.safeParse(photoId).success) return;
  const found = await loadLog(ctx, logId);
  if (!found?.access.contribute) return;
  const photo = await db.photo.findFirst({ where: { id: photoId, projectId, dailyLogId: found.log.id } });
  if (!photo || (!ctx.canCreate && photo.uploadedById !== ctx.user.id)) return;
  await db.$transaction([
    db.photo.delete({ where: { id: photo.id } }),
    db.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "daily_log.photo_deleted", details: { logId: found.log.id, date: dateToDay(found.log.date), photoId, name: photo.fileName } },
    }),
  ]);
  try {
    await getStorage().remove([photo.storageKey, photo.thumbKey]);
  } catch (e) {
    console.error("daily-logs: failed to remove stored photo", e);
  }
  refresh(projectId);
}
