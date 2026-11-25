import Link from "next/link";
import { card } from "@/components/ui";
import { canDeletePhoto } from "@/modules/issues/media";
import { canAddProjectPhotos, galleryPage, type GalleryFilter } from "@/modules/issues/media-server";
import type { IssuesContext } from "@/modules/issues/server";
import { PhotoGrid } from "./PhotoGrid";
import { PhotoUploader } from "./PhotoUploader";

const FILTERS: { id: GalleryFilter; label: string }[] = [
  { id: "all", label: "All photos" },
  { id: "issues", label: "On issues" },
  { id: "project", label: "Project photos" },
  { id: "checklists", label: "On checklists" },
  { id: "daily-logs", label: "On daily logs" },
];

/** ⭐ The project photo gallery, shown under both Issues and Document Control. */
export async function PhotoGallery({ ctx, basePath, filter, page }: { ctx: IssuesContext; basePath: string; filter: GalleryFilter; page: number }) {
  const { photos, more } = await galleryPage(ctx, filter, page);
  const href = (f: GalleryFilter, p = 1) => `${basePath}?${new URLSearchParams({ ...(f !== "all" ? { filter: f } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Photos</h2>
          <p className="text-sm text-ink-soft">Site photos from issues, checklists, daily logs and the project, newest first.</p>
        </div>
        <nav aria-label="Photo filter" className="flex max-w-full overflow-x-auto rounded-md border border-line">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={href(f.id)}
              aria-current={filter === f.id ? "page" : undefined}
              className={`whitespace-nowrap px-3 py-1.5 text-sm font-medium ${filter === f.id ? "bg-brand text-white" : "bg-surface hover:bg-muted"}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </div>
      {canAddProjectPhotos(ctx) && (
        <section className={`${card} p-4`}>
          <h3 className="mb-2 text-sm font-semibold">Add project photos</h3>
          <PhotoUploader projectId={ctx.project.id} issueId={null} />
        </section>
      )}
      {photos.length === 0 ? (
        <p className={`${card} p-6 text-sm text-ink-soft`} data-testid="no-photos">{page > 1 ? "No more photos." : "No photos yet."}</p>
      ) : (
        <PhotoGrid
          projectId={ctx.project.id}
          timezone={ctx.project.timezone}
          showIssue
          photos={photos.map((p) => ({ ...p, checklist: p.checklistItem?.checklist ?? null, dailyLogDay: p.dailyLog ? p.dailyLog.date.toISOString().slice(0, 10) : null, canDelete: !p.checklistItem && !p.dailyLog && canDeletePhoto(p, ctx.user.id, ctx.canManage || (!p.issueId && ctx.isAdmin)) }))}
        />
      )}
      <div className="flex gap-2">
        {page > 1 && <Link href={href(filter, page - 1)} className="text-sm font-medium text-brand hover:underline">← Newer</Link>}
        {more && <Link href={href(filter, page + 1)} className="text-sm font-medium text-brand hover:underline">Older photos →</Link>}
      </div>
    </div>
  );
}

export function parseGalleryParams(sp: { filter?: string; page?: string }) {
  const filter: GalleryFilter = sp.filter === "issues" || sp.filter === "project" || sp.filter === "checklists" || sp.filter === "daily-logs" ? sp.filter : "all";
  const page = Math.min(1000, Math.max(1, parseInt(sp.page ?? "1", 10) || 1));
  return { filter, page };
}
