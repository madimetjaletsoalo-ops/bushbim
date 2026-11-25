import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getDocsContext } from "@/modules/docs/access";
import { levelAtLeast } from "@/modules/docs/folder-permissions";
import { isViewable } from "@/modules/docs/markup";
import { GALLERY_PAGE_SIZE } from "./media";
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
/** Plain project photos (not on an issue) can be added by Issues Creators or Document Control Creators. */
export const canAddProjectPhotos = (ctx: IssuesContext) => ctx.canCreate || can(ctx.member, "DOCS", "create", ctx.grants);

export type GalleryFilter = "all" | "issues" | "project";

/** One page of the project gallery, newest first, holding only photos the member may see. */
export async function galleryPage(ctx: IssuesContext, filter: GalleryFilter, page: number) {
  const issues = visibleIssueWhere(ctx);
  const onIssues: Prisma.PhotoWhereInput | null = issues ? { issueId: { not: null }, issue: issues } : null;
  const project: Prisma.PhotoWhereInput | null = canSeeProjectPhotos(ctx) ? { issueId: null } : null;
  const parts = (filter === "issues" ? [onIssues] : filter === "project" ? [project] : [onIssues, project]).filter((x): x is Prisma.PhotoWhereInput => !!x);
  if (!parts.length) return { photos: [], more: false };
  const rows = await db.photo.findMany({
    where: { projectId: ctx.project.id, OR: parts },
    include: { uploadedBy: { select: { name: true } }, issue: { select: { id: true, number: true, title: true } } },
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
    include: { issue: { include: { status: true } } },
  });
  if (!photo) return null;
  if (photo.issue) {
    const a = accessFor(ctx, photo.issue);
    if (!a.see) return null;
    return { photo, manager: ctx.canManage };
  }
  if (!canSeeProjectPhotos(ctx)) return null;
  return { photo, manager: ctx.canManage || ctx.isAdmin };
}
