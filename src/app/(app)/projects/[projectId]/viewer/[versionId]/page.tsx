import { notFound } from "next/navigation";
import { Viewer } from "@/components/docs/Viewer";
import { db } from "@/lib/db";
import { getDocsContext } from "@/modules/docs/access";
import { levelAtLeast } from "@/modules/docs/folder-permissions";
import { isActiveReviewerOf } from "@/modules/reviews/server";
import { isImage, isViewable, visibleTo, type Pt } from "@/modules/docs/markup";

export default async function ViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; versionId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { projectId, versionId } = await params;
  const initialPage = Math.max(1, parseInt((await searchParams).page ?? "1", 10) || 1);
  const ctx = await getDocsContext(projectId);
  const v = await db.documentVersion.findFirst({
    where: { id: versionId, document: { projectId } },
    include: {
      document: { include: { versions: { orderBy: { number: "desc" }, select: { id: true, number: true } } } },
      markups: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      calibrations: true,
    },
  });
  if (!v) notFound();
  const level = ctx.levelOn(v.document.folderId);
  if (!levelAtLeast(level, "VIEW") || !isViewable(v.contentType, v.fileName)) notFound();
  const markups = visibleTo(v.markups, ctx.user.id).map((m) => ({
    id: m.id,
    page: m.page,
    type: m.type,
    points: m.points as Pt[],
    color: m.color,
    text: m.text,
    status: m.status,
    authorId: m.authorId,
    authorName: m.author?.name ?? "Former member",
  }));
  const api = `/api/projects/${projectId}/versions/${versionId}`;
  // reviewers of an open review of this version can publish their markups
  const canPublish = levelAtLeast(level, "UPLOAD") || (await isActiveReviewerOf(projectId, versionId, ctx.member));
  // previous version, for "Compare with V(n-1)"
  const prev = v.document.versions.find((x) => x.number === v.number - 1) ?? null;
  return (
    <Viewer
      projectId={projectId}
      versionId={versionId}
      name={v.document.name}
      versionNumber={v.number}
      versions={v.document.versions.map((x) => ({ id: x.id, number: x.number, href: `/projects/${projectId}/viewer/${x.id}` }))}
      kind={isImage(v.contentType, v.fileName) ? "image" : "pdf"}
      src={`${api}/view`}
      exportHref={levelAtLeast(level, "VIEW_DOWNLOAD") ? `${api}/export` : null}
      backHref={`/projects/${projectId}/docs/folders/${v.document.folderId}`}
      me={ctx.user.id}
      canPublish={canPublish}
      canCalibrate={levelAtLeast(level, "UPLOAD")}
      canManage={levelAtLeast(level, "MANAGE")}
      initialMarkups={markups}
      initialScales={v.calibrations.map((c) => ({ page: c.page, unitsPerPoint: c.unitsPerPoint, unit: c.unit }))}
      initialPage={initialPage}
      compareBase={prev ? `/projects/${projectId}/compare?a=${prev.id}&b=${versionId}` : null}
    />
  );
}
