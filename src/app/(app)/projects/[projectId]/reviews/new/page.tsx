import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { card, input, label } from "@/components/ui";
import { db } from "@/lib/db";
import { getDocsContext } from "@/modules/docs/access";
import { pathUp } from "@/modules/docs/folder-permissions";
import { versionLabel } from "@/modules/docs/logic";
import { startReview } from "@/modules/reviews/actions";
import { canInitiate } from "@/modules/reviews/server";

export default async function NewReviewPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ folderId?: string }> }) {
  const { projectId } = await params;
  const { folderId } = await searchParams;
  const ctx = await getDocsContext(projectId);
  const { openable } = ctx.visible();
  const workflows = (
    await db.reviewWorkflow.findMany({ where: { projectId, active: true }, include: { _count: { select: { steps: true } } }, orderBy: { name: "asc" } })
  ).filter((w) => canInitiate(ctx.member, ctx.grants, w.initiators));

  const inFolder = folderId && openable.has(folderId) ? folderId : null;
  const docs = await db.document.findMany({
    where: { projectId, folderId: inFolder ? inFolder : { in: [...openable] } },
    include: { versions: { orderBy: { number: "desc" }, take: 1, select: { id: true, number: true } } },
    orderBy: [{ folderId: "asc" }, { name: "asc" }],
    take: 300,
  });
  const folderPath = (id: string) =>
    pathUp(ctx.index, id)
      .reverse()
      .map((f) => ctx.index.byId.get(f)?.name)
      .join(" / ");
  const byFolder = new Map<string, typeof docs>();
  for (const d of docs) byFolder.set(d.folderId, [...(byFolder.get(d.folderId) ?? []), d]);
  const base = `/projects/${projectId}/reviews`;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Start a review</h2>
      {workflows.length === 0 ? (
        <div className={`${card} p-6 text-sm text-ink-soft`}>
          There is no workflow you can start. {ctx.isAdmin ? <Link className="text-brand hover:underline" href={`${base}/workflows`}>Define a workflow</Link> : "Ask a project admin to set one up or add you as an initiator."}
        </div>
      ) : (
        <ActionForm action={startReview.bind(null, projectId)} className={`${card} space-y-4 p-4`} testId="start-review-form" resetOnSuccess={false}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="workflowId">Workflow</label>
              <select className={input} id="workflowId" name="workflowId" required>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>{w.name} ({w._count.steps} {w._count.steps === 1 ? "step" : "steps"})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="name">Review name</label>
              <input className={input} id="name" name="name" required maxLength={200} placeholder="e.g. Villa 4 IFC drawings" />
            </div>
          </div>
          <fieldset>
            <legend className={label}>Files</legend>
            {inFolder && (
              <p className="mb-2 text-xs text-ink-soft">
                Showing {folderPath(inFolder)}. <Link className="text-brand hover:underline" href={`${base}/new`}>Show all folders</Link>
              </p>
            )}
            {docs.length === 0 ? (
              <p className="text-sm text-ink-soft">No files to review here yet.</p>
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto rounded-md border border-line p-3">
                {[...byFolder].map(([fid, list]) => (
                  <div key={fid}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{folderPath(fid)}</p>
                    <ul className="mt-1 space-y-1">
                      {list.map((d) =>
                        d.versions[0] ? (
                          <li key={d.id}>
                            <label className="flex items-start gap-2 text-sm">
                              <input type="checkbox" name="versionIds" value={d.versions[0].id} className="mt-0.5" aria-label={`Include ${d.name}`} />
                              <span className="break-all">
                                {d.name} <span className="text-ink-soft">{versionLabel(d.versions[0].number)}</span>
                              </span>
                            </label>
                          </li>
                        ) : null,
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </fieldset>
          <SubmitButton>Start review</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
