import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/docs/ConfirmButton";
import { PhotoGrid } from "@/components/issues/PhotoGrid";
import { PhotoUploader } from "@/components/issues/PhotoUploader";
import { IssueFields } from "@/components/issues/IssueFields";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, btnGhost, card, input, label } from "@/components/ui";
import { db } from "@/lib/db";
import { addIssueComment, changeIssueStatus, toggleWatch, updateIssue } from "@/modules/issues/actions";
import { removePin } from "@/modules/issues/media-actions";
import { canDeletePhoto } from "@/modules/issues/media";
import { pinTarget } from "@/modules/issues/media-server";
import { checklistLabel } from "@/modules/checklists/logic";
import { isOverdue, issueLabel, listOptions, statusLabel } from "@/modules/issues/logic";
import { accessFor, getIssuesContext } from "@/modules/issues/server";

const ACTIVITY_LABEL: Record<string, string> = {
  "issue.created": "created the issue",
  "issue.updated": "edited",
  "issue.status_changed": "changed the status",
  "issue.commented": "commented",
  "issue.watched": "started watching",
  "issue.unwatched": "stopped watching",
  "issue.pinned": "pinned it on a sheet",
  "issue.unpinned": "removed the pin",
  "issue.photo_added": "added a photo",
  "issue.photo_deleted": "removed a photo",
};

export default async function IssuePage({ params }: { params: Promise<{ projectId: string; issueId: string }> }) {
  const { projectId, issueId } = await params;
  const ctx = await getIssuesContext(projectId);
  const issue = await db.issue.findFirst({
    where: { id: issueId, projectId },
    include: {
      status: true,
      type: true,
      subtype: true,
      rootCause: true,
      createdBy: { select: { name: true } },
      watchers: { include: { user: { select: { name: true } } }, orderBy: { addedAt: "asc" } },
      comments: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 500 },
      pin: true,
      checklistItem: { select: { checklist: { select: { id: true, number: true, title: true } } } },
      photos: { include: { uploadedBy: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 200 },
    },
  });
  if (!issue) notFound();
  const access = accessFor(ctx, issue);
  if (!access.see) notFound();
  const activity = await db.auditEvent.findMany({
    where: { projectId, action: { startsWith: "issue." }, details: { path: ["issueId"], equals: issue.id } },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.project.timezone });
  const day = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "UTC" });
  const watching = issue.watchers.some((w) => w.userId === ctx.user.id);
  const overdue = isOverdue(issue.dueDate, issue.status.closed, ctx.project.timezone);
  const location = ctx.locationPaths.find((l) => l.id === issue.locationId)?.path;
  // the sheet the pin is on, if this member can open it
  const pinDoc = issue.pin ? await pinTarget(projectId, issue.pin.versionId) : null;
  const pinSheet = issue.pin && pinDoc ? await db.sheet.findUnique({ where: { versionId_page: { versionId: issue.pin.versionId, page: issue.pin.page } } }) : null;
  const canAddPhotos = access.see && (ctx.canCreate || access.status);
  const attrs = (issue.attributes && typeof issue.attributes === "object" ? issue.attributes : {}) as Record<string, string>;

  const facts: [string, React.ReactNode][] = [
    ["Type", issue.type ? `${issue.type.name}${issue.subtype ? ` › ${issue.subtype.name}` : ""}` : "—"],
    ["Assigned to", ctx.assigneeName(issue.assigneeType, issue.assigneeId) ?? "Unassigned"],
    ["Due date", issue.dueDate ? <span className={overdue ? "font-medium text-red-700" : ""}>{day.format(issue.dueDate)}{overdue && " (overdue)"}</span> : "—"],
    ["Location", location ?? "—"],
    ["Root cause", issue.rootCause?.name ?? "—"],
    ...ctx.attributes.map((a): [string, React.ReactNode] => [a.name, (a.kind !== "LIST" || listOptions(a.options).includes(attrs[a.id])) && attrs[a.id] ? attrs[a.id] : "—"]),
  ];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Link href={`/projects/${projectId}/issues`} className="text-sm text-ink-soft hover:underline">← Issues</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xl font-semibold break-words">
            <span className="text-ink-soft">{issueLabel(issue.number)}</span> {issue.title}
          </h2>
          <form action={toggleWatch.bind(null, projectId, issue.id)}>
            <button type="submit" className={btnGhost}>{watching ? "Stop watching" : "Watch"}</button>
          </form>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          <span className={`${badge} text-ink`} style={{ background: `${issue.status.color}22`, boxShadow: `inset 0 0 0 1px ${issue.status.color}` }} data-testid="issue-status">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: issue.status.color }} aria-hidden />
            {statusLabel(issue.status, ctx.statuses)}
          </span>
          <span>Created by {issue.createdBy?.name ?? "former member"} {fmt.format(issue.createdAt)}</span>
          {issue.checklistItem && (
            <Link href={`/projects/${projectId}/checklists/${issue.checklistItem.checklist.id}`} className="font-medium text-brand hover:underline" data-testid="from-checklist">
              From checklist {checklistLabel(issue.checklistItem.checklist.number)}
            </Link>
          )}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          {access.edit ? (
            <section className={`${card} p-5`}>
              <h3 className="mb-4 font-semibold">Details</h3>
              <ActionForm action={updateIssue.bind(null, projectId, issue.id)} resetOnSuccess={false} testId="edit-issue-form" className="space-y-4">
                <IssueFields
                  ctx={ctx}
                  idPrefix="edit"
                  defaults={{ ...issue, watcherIds: issue.watchers.map((w) => w.userId) }}
                />
                <SubmitButton>Save changes</SubmitButton>
              </ActionForm>
            </section>
          ) : (
            <section className={`${card} p-5`} data-testid="issue-readonly">
              <h3 className="mb-3 font-semibold">Details</h3>
              {issue.description && <p className="mb-4 whitespace-pre-wrap text-sm">{issue.description}</p>}
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                {facts.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-ink-soft">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
              </dl>
              {ctx.level === "CREATOR" && <p className="mt-4 text-xs text-ink-soft">Creators can edit only the issues they created.</p>}
            </section>
          )}

          <section className={`${card} p-5`} data-testid="issue-photos">
            <h3 className="mb-3 font-semibold">Photos ({issue.photos.length})</h3>
            {issue.photos.length === 0 ? (
              <p className="mb-3 text-sm text-ink-soft">No photos yet.</p>
            ) : (
              <div className="mb-4">
                <PhotoGrid
                  projectId={projectId}
                  timezone={ctx.project.timezone}
                  photos={issue.photos.map((p) => ({ ...p, canDelete: canDeletePhoto(p, ctx.user.id, ctx.canManage) }))}
                />
              </div>
            )}
            {canAddPhotos && <PhotoUploader projectId={projectId} issueId={issue.id} />}
          </section>

          <section className={`${card} p-5`}>
            <h3 className="mb-3 font-semibold">Comments</h3>
            {issue.comments.length === 0 ? (
              <p className="text-sm text-ink-soft">No comments yet.</p>
            ) : (
              <ul className="space-y-3" data-testid="comments">
                {issue.comments.map((c) => (
                  <li key={c.id} className="rounded-md bg-muted/60 px-3 py-2" data-testid="comment">
                    <p className="text-xs text-ink-soft">{c.author?.name ?? "Former member"} · {fmt.format(c.createdAt)}</p>
                    <p className="whitespace-pre-wrap text-sm break-words">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
            {access.comment && (
              <ActionForm action={addIssueComment.bind(null, projectId, issue.id)} className="mt-4 space-y-2" testId="comment-form">
                <label className={label} htmlFor="comment-body">Add a comment</label>
                <textarea className={input} id="comment-body" name="body" rows={2} maxLength={5000} required />
                <SubmitButton>Post comment</SubmitButton>
              </ActionForm>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-5">
          {access.status && (
            <section className={`${card} p-5`}>
              <h3 className="mb-3 font-semibold">Change status</h3>
              <ActionForm action={changeIssueStatus.bind(null, projectId, issue.id)} resetOnSuccess={false} testId="status-form" className="space-y-3">
                <div>
                  <label className={label} htmlFor="new-status">Status</label>
                  <select className={input} id="new-status" name="statusId" defaultValue={issue.statusId}>
                    {ctx.statuses.map((s) => <option key={s.id} value={s.id}>{statusLabel(s, ctx.statuses)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="status-comment">Comment (optional)</label>
                  <textarea className={input} id="status-comment" name="comment" rows={2} maxLength={5000} />
                </div>
                <SubmitButton>Update status</SubmitButton>
              </ActionForm>
            </section>
          )}
          <section className={`${card} p-5`} data-testid="issue-pin">
            <h3 className="mb-2 font-semibold">On a sheet</h3>
            {!issue.pin ? (
              <p className="text-sm text-ink-soft">Not pinned. {access.edit ? "Open a sheet in Document Control and use the Pin tool." : ""}</p>
            ) : pinDoc ? (
              <div className="space-y-2 text-sm">
                <p className="break-words">
                  {pinSheet ? <><span className="font-medium">{pinSheet.number}</span> {pinSheet.title}</> : <span className="font-medium">{pinDoc.document.name}</span>}
                  <span className="block text-xs text-ink-soft">V{pinDoc.number} · page {issue.pin.page}</span>
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link href={`/projects/${projectId}/viewer/${issue.pin.versionId}?page=${issue.pin.page}&pin=${issue.id}`} className="font-medium text-brand hover:underline">
                    Open sheet at pin
                  </Link>
                  {access.edit && (
                    <form action={removePin.bind(null, projectId, issue.id)}>
                      <ConfirmButton message="Remove this issue's pin from the sheet?" className="font-medium text-red-700 hover:underline">Remove pin</ConfirmButton>
                    </form>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-soft">Pinned on a sheet you can&apos;t open.</p>
            )}
          </section>
          <section className={`${card} p-5`}>
            <h3 className="mb-2 font-semibold">Watchers</h3>
            {issue.watchers.length === 0 ? (
              <p className="text-sm text-ink-soft">Nobody is watching.</p>
            ) : (
              <ul className="space-y-1 text-sm" data-testid="watchers">
                {issue.watchers.map((w) => <li key={w.userId}>{w.user.name}</li>)}
              </ul>
            )}
          </section>
          <section className={`${card} p-5`}>
            <h3 className="mb-2 font-semibold">Activity</h3>
            <ol className="space-y-2 text-sm" data-testid="issue-activity">
              {activity.map((e) => {
                const d = (e.details ?? {}) as { from?: string; to?: string; fields?: string[] };
                return (
                  <li key={e.id}>
                    <span className="font-medium">{e.actor.name}</span> {ACTIVITY_LABEL[e.action] ?? e.action}
                    {e.action === "issue.status_changed" && ` from ${d.from} to ${d.to}`}
                    {e.action === "issue.updated" && d.fields?.length ? ` ${d.fields.join(", ")}` : ""}
                    <span className="block text-xs text-ink-soft">{fmt.format(e.createdAt)}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
