import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { can } from "@/lib/permissions";
import { getDocsContext } from "@/modules/docs/access";
import { levelAtLeast } from "@/modules/docs/folder-permissions";
import { isViewable } from "@/modules/docs/markup";
import { GALLERY_PAGE_SIZE, THUMB_MAX_WIDTH, checkStoredPhoto, jpegSize } from "./media";
import { accessFor, type IssuesContext } from "./server";

/**
 * The document version a pin goes on, if the member can open it in the viewer
 * (View on its folder). Null when it isn't in this project, can't be viewed, or is hidden.
 */
export async function pinTarget(projectId: string, versionId: string) {
  const docs = await getDocsContext(projectId);
  const v = await db.documentVersion.findFirst({
    where: { id: versionId, document: { projectId } },
    select: { id: true, number: true, fileName: true, contentType: true, document: { select: { name: true, folderId: true } } },
  });
  if (!v || !isViewable(v.contentType, v.fileName)) return null;
  if (!levelAtLeast(docs.levelOn(v.document.folderId), "VIEW")) return null;
  return v;
}

/** Prisma filter for the issues a member may see (drafts only for their creator and Managers). */
export function visibleIssueWhere(ctx: IssuesContext): Prisma.IssueWhereInput | null {
  if (!ctx.canView) return null;
  if (ctx.canManage) return { projectId: ctx.project.id };
  return { projectId: ctx.project.id, OR: [{ status: { draft: false } }, { createdById: ctx.user.id }] };
}

/** Project photos can be seen by anyone with Issues or Document Control access. */
export const canSeeProjectPhotos = (ctx: IssuesContext) => ctx.canView || can(ctx.member, "DOCS", "view", ctx.grants);
/** Photos on checklist items can be seen by anyone with Checklists access. */
export const canSeeChecklistPhotos = (ctx: IssuesContext) => can(ctx.member, "CHECKLISTS", "view", ctx.grants);
/** Plain project photos (not on an issue) can be added by Issues Creators or Document Control Creators. */
export const canAddProjectPhotos = (ctx: IssuesContext) => ctx.canCreate || can(ctx.member, "DOCS", "create", ctx.grants);

/** Photos on daily logs can be seen by anyone with Daily Logs access. */
export const canSeeDailyLogPhotos = (ctx: IssuesContext) => can(ctx.member, "DAILY_LOGS", "view", ctx.grants);

export type GalleryFilter = "all" | "issues" | "project" | "checklists" | "daily-logs";

/** One page of the project gallery, newest first, holding only photos the member may see. */
export async function galleryPage(ctx: IssuesContext, filter: GalleryFilter, page: number) {
  const issues = visibleIssueWhere(ctx);
  const onIssues: Prisma.PhotoWhereInput | null = issues ? { issueId: { not: null }, issue: issues } : null;
  const project: Prisma.PhotoWhereInput | null = canSeeProjectPhotos(ctx) ? { issueId: null, checklistItemId: null, dailyLogId: null } : null;
  const onChecklists: Prisma.PhotoWhereInput | null = canSeeChecklistPhotos(ctx) ? { checklistItemId: { not: null } } : null;
  const onLogs: Prisma.PhotoWhereInput | null = canSeeDailyLogPhotos(ctx) ? { dailyLogId: { not: null } } : null;
  const chosen =
    filter === "issues" ? [onIssues] : filter === "project" ? [project] : filter === "checklists" ? [onChecklists] : filter === "daily-logs" ? [onLogs] : [onIssues, project, onChecklists, onLogs];
  const parts = chosen.filter((x): x is Prisma.PhotoWhereInput => !!x);
  if (!parts.length) return { photos: [], more: false };
  const rows = await db.photo.findMany({
    where: { projectId: ctx.project.id, OR: parts },
    include: {
      uploadedBy: { select: { name: true } },
      issue: { select: { id: true, number: true, title: true } },
      checklistItem: { select: { checklist: { select: { id: true, number: true, title: true } } } },
      dailyLog: { select: { date: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * GALLERY_PAGE_SIZE,
    take: GALLERY_PAGE_SIZE + 1,
  });
  return { photos: rows.slice(0, GALLERY_PAGE_SIZE), more: rows.length > GALLERY_PAGE_SIZE };
}

/** Loads a photo with the member's rights on it: see, delete. Null when it doesn't exist for them. */
export async function photoAccess(ctx: IssuesContext, photoId: string) {
  if (!photoId || photoId.length > 64) return null;
  const photo = await db.photo.findFirst({
    where: { id: photoId, projectId: ctx.project.id },
    include: { issue: { include: { status: true } }, checklistItem: { select: { checklistId: true } } },
  });
  if (!photo) return null;
  if (photo.checklistItem) {
    if (!canSeeChecklistPhotos(ctx)) return null;
    // checklist photos are removed from their checklist, never from the gallery
    return { photo, manager: false };
  }
  if (photo.dailyLogId) {
    if (!canSeeDailyLogPhotos(ctx)) return null;
    // daily log photos are removed from their log, never from the gallery
    return { photo, manager: false };
  }
  if (photo.issue) {
    const a = accessFor(ctx, photo.issue);
    if (!a.see) return null;
    return { photo, manager: ctx.canManage };
  }
  if (!canSeeProjectPhotos(ctx)) return null;
  return { photo, manager: ctx.canManage || ctx.isAdmin };
}

/**
 * After the browser has PUT a compressed photo and its thumbnail: checks both arrived whole
 * and really are JPEGs within the width limits. Bad uploads are removed from storage.
 */
export async function verifyUploadedPhoto(c: { key: string; tkey: string; size: number; tsize: number; name: string }) {
  const storage = getStorage();
  const discard = () => storage.remove([c.key, c.tkey]).catch(() => {});
  const [size, tsize] = await Promise.all([storage.head(c.key), storage.head(c.tkey)]);
  if (size === null || tsize === null) return { ok: false as const, error: `${c.name} didn't finish uploading. Try again.` };
  if (size !== c.size || tsize !== c.tsize) {
    await discard();
    return { ok: false as const, error: `${c.name} arrived incomplete. Try again.` };
  }
  const [main, thumb] = await Promise.all([storage.read(c.key), storage.read(c.tkey)]);
  const dims = jpegSize(main);
  const problem = checkStoredPhoto(dims) ?? checkStoredPhoto(jpegSize(thumb), THUMB_MAX_WIDTH);
  if (problem || !dims) {
    await discard();
    return { ok: false as const, error: `${c.name}: ${problem ?? "That file isn't a JPEG photo."}` };
  }
  return { ok: true as const, size, dims };
}
