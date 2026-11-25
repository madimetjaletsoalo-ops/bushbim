import Link from "next/link";
import { ConfirmButton } from "@/components/docs/ConfirmButton";
import { checklistLabel } from "@/modules/checklists/logic";
import { issueLabel } from "@/modules/issues/logic";
import { deletePhoto } from "@/modules/issues/media-actions";

export type GridPhoto = {
  id: string;
  fileName: string;
  width: number;
  height: number;
  caption: string | null;
  createdAt: Date;
  uploadedBy: { name: string } | null;
  issue?: { id: string; number: number; title: string } | null;
  checklist?: { id: string; number: number; title: string } | null;
  /** "YYYY-MM-DD" of the daily log the photo is on */
  dailyLogDay?: string | null;
  canDelete: boolean;
};

/** Thumbnail grid; each opens the full photo. Thumbnails are ~320 px JPEGs and load lazily. */
export function PhotoGrid({ projectId, photos, timezone, showIssue }: { projectId: string; photos: GridPhoto[]; timezone: string; showIssue?: boolean }) {
  const day = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: timezone });
  const src = (id: string, thumb = false) => `/api/projects/${projectId}/photos/${id}${thumb ? "?size=thumb" : ""}`;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="photo-grid">
      {photos.map((p) => (
        <li key={p.id} className="min-w-0 overflow-hidden rounded-md border border-line bg-surface" data-testid="photo">
          <a href={src(p.id)} target="_blank" rel="noopener" className="block aspect-[4/3] bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src(p.id, true)}
              alt={p.caption ?? p.fileName}
              loading="lazy"
              decoding="async"
              width={320}
              height={Math.round((320 * p.height) / Math.max(1, p.width))}
              className="h-full w-full object-cover"
            />
          </a>
          <div className="space-y-0.5 p-2 text-xs">
            {p.caption && <p className="line-clamp-2 text-sm text-ink break-words">{p.caption}</p>}
            {showIssue &&
              (p.issue ? (
                <Link href={`/projects/${projectId}/issues/${p.issue.id}`} className="block truncate font-medium text-brand hover:underline" data-testid="photo-issue">
                  {issueLabel(p.issue.number)} {p.issue.title}
                </Link>
              ) : p.checklist ? (
                <Link href={`/projects/${projectId}/checklists/${p.checklist.id}`} className="block truncate font-medium text-brand hover:underline" data-testid="photo-checklist">
                  {checklistLabel(p.checklist.number)} {p.checklist.title}
                </Link>
              ) : p.dailyLogDay ? (
                <Link href={`/projects/${projectId}/daily-logs/${p.dailyLogDay}`} className="block truncate font-medium text-brand hover:underline" data-testid="photo-daily-log">
                  Daily log {p.dailyLogDay}
                </Link>
              ) : (
                <p className="text-ink-soft">Project photo</p>
              ))}
            <p className="truncate text-ink-soft">
              {p.uploadedBy?.name ?? "Former member"} · {day.format(p.createdAt)}
            </p>
            <div className="flex gap-3">
              <a href={`${src(p.id)}?download=1`} className="font-medium text-brand hover:underline">Download</a>
              {p.canDelete && (
                <form action={deletePhoto.bind(null, projectId, p.id)}>
                  <ConfirmButton message="Delete this photo?" className="font-medium text-red-700 hover:underline">Delete</ConfirmButton>
                </form>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
