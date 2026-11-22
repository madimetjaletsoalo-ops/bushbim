import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, btnGhost, card, input, label, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { levelAtLeast } from "@/modules/docs/folder-permissions";
import { versionLabel } from "@/modules/docs/logic";
import { isViewable } from "@/modules/docs/markup";
import { submitDecision } from "@/modules/reviews/actions";
import { OUTCOME_BADGE, labelFor, parseStatuses, parseSubjects, type Outcome } from "@/modules/reviews/logic";
import { reviewAccess } from "@/modules/reviews/server";

export default async function ReviewPage({ params }: { params: Promise<{ projectId: string; reviewId: string }> }) {
  const { projectId, reviewId } = await params;
  const ctx = await reviewAccess(projectId, reviewId);
  if (!ctx) notFound();
  const { review, steps, current, canReviewNow } = ctx;
  const statuses = parseStatuses(review.workflow.statuses);
  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.project.timezone });

  // names for the reviewers listed on each step
  const subjects = [...new Set(steps.flatMap((s) => s.reviewers))];
  const ids = (t: string) => subjects.filter((s) => s.startsWith(`${t}:`)).map((s) => s.slice(t.length + 1));
  const [users, roles, companies, copies] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids("USER") } }, select: { id: true, name: true } }),
    db.role.findMany({ where: { id: { in: ids("ROLE") } }, select: { id: true, name: true } }),
    db.company.findMany({ where: { id: { in: ids("COMPANY") } }, select: { id: true, name: true } }),
    db.documentVersion.findMany({
      where: { id: { in: review.documents.map((d) => d.copiedVersionId).filter((x): x is string => !!x) } },
      select: { id: true, number: true, document: { select: { folderId: true, folder: { select: { name: true } } } } },
    }),
  ]);
  const names = new Map<string, string>([
    ...users.map((u) => [`USER:${u.id}`, u.name] as const),
    ...roles.map((r) => [`ROLE:${r.id}`, `${r.name} (role)`] as const),
    ...companies.map((c) => [`COMPANY:${c.id}`, `${c.name} (company)`] as const),
  ]);
  const docName = new Map(review.documents.map((d) => [d.id, `${d.version.document.name} ${versionLabel(d.version.number)}`]));
  const myDecisions = new Map(
    review.decisions.filter((d) => d.step === review.currentStep && d.reviewerId === ctx.user.id).map((d) => [d.reviewDocumentId, d]),
  );
  const base = `/projects/${projectId}`;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link href={`${base}/reviews`} className="text-sm text-ink-soft hover:underline">← Reviews</Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">
            <span className="text-ink-soft">#{review.number}</span> {review.name}
          </h2>
          {review.status === "CLOSED" && (
            <a className={btnGhost} href={`/api/projects/${projectId}/reviews/${review.id}/export`} data-testid="export-review">Export PDF</a>
          )}
        </div>
        <p className="text-sm text-ink-soft" data-testid="review-status">
          {review.status === "OPEN" ? (
            <>Open · Step {review.currentStep} of {steps.length}: {current?.name}{review.stepDueAt && <> · due {fmt.format(review.stepDueAt)}</>}</>
          ) : (
            <>Closed{review.closedAt && <> {fmt.format(review.closedAt)}</>}</>
          )}
          {" · "}{review.workflow.name} · started by {review.initiator?.name ?? "former member"} {fmt.format(review.createdAt)}
          {review.autoStarted && " (automatically on upload)"}
        </p>
      </div>

      <section className={`${card} overflow-x-auto`}>
        <table className="w-full" data-testid="review-files">
          <thead className="border-b border-line bg-muted/50">
            <tr>
              <th className={th}>File</th>
              <th className={th}>Outcome</th>
              <th className={th}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {review.documents.map((d) => {
              const v = d.version;
              const canView = levelAtLeast(ctx.levelOn(v.document.folderId), "VIEW");
              const copy = copies.find((c) => c.id === d.copiedVersionId);
              return (
                <tr key={d.id} data-testid="review-file">
                  <td className={td}>
                    <span className="break-all font-medium">{v.document.name}</span> <span className="text-ink-soft">{versionLabel(v.number)}</span>
                    {copy && (
                      <p className="mt-1 text-xs text-ink-soft" data-testid="copied-to">
                        Copied to{" "}
                        {levelAtLeast(ctx.levelOn(copy.document.folderId), "VIEW") ? (
                          <Link className="text-brand hover:underline" href={`${base}/docs/folders/${copy.document.folderId}`}>{copy.document.folder.name}</Link>
                        ) : (
                          copy.document.folder.name
                        )}{" "}
                        as {versionLabel(copy.number)}
                      </p>
                    )}
                  </td>
                  <td className={td}>
                    {d.outcome ? <span className={`${badge} ${OUTCOME_BADGE[d.outcome as Outcome]}`} data-testid="file-outcome">{labelFor(statuses, d.outcome as Outcome)}</span> : <span className="text-ink-soft">—</span>}
                  </td>
                  <td className={`${td} text-right`}>
                    {canView && isViewable(v.contentType, v.fileName) ? (
                      <Link className="text-sm font-medium text-brand hover:underline" href={`${base}/viewer/${v.id}`} aria-label={`Open ${v.document.name} in the viewer`}>
                        View &amp; mark up
                      </Link>
                    ) : !canView ? (
                      <span className="text-xs text-ink-soft">No folder access</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {canReviewNow && current && (
        <section className={`${card} p-4`}>
          <h3 className="mb-1 font-semibold">Your review · Step {current.order}: {current.name}</h3>
          <p className="mb-3 text-xs text-ink-soft">
            Choose a status for each file. Markups you publish in the viewer are part of the review.
            {myDecisions.size > 0 && " You can change your response until the step completes."}
          </p>
          <ActionForm action={submitDecision.bind(null, projectId, review.id)} className="space-y-4" testId="decision-form" resetOnSuccess={false}>
            <input type="hidden" name="step" value={current.order} />
            {review.documents.map((d) => (
              <fieldset key={d.id} className="space-y-2 rounded-md border border-line p-3">
                <legend className="break-all px-1 text-sm font-medium">{docName.get(d.id)}</legend>
                <div>
                  <label className={label} htmlFor={`outcome_${d.id}`}>Status for {d.version.document.name}</label>
                  <select className={input} id={`outcome_${d.id}`} name={`outcome_${d.id}`} required defaultValue={myDecisions.get(d.id)?.outcome ?? ""}>
                    <option value="" disabled>Choose…</option>
                    {statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor={`comment_${d.id}`}>Comment on {d.version.document.name}</label>
                  <textarea className={input} id={`comment_${d.id}`} name={`comment_${d.id}`} rows={2} maxLength={2000} defaultValue={myDecisions.get(d.id)?.comment ?? ""} />
                </div>
              </fieldset>
            ))}
            <SubmitButton>Submit review</SubmitButton>
          </ActionForm>
        </section>
      )}

      <section className="space-y-3" aria-label="Steps">
        <h3 className="font-semibold">Steps</h3>
        <ol className="space-y-3">
          {steps.map((s) => {
            const state = review.status === "CLOSED" || s.order < review.currentStep ? "Done" : s.order === review.currentStep ? "In progress" : "Waiting";
            const decisions = review.decisions.filter((d) => d.step === s.order);
            const byReviewer = new Map<string, typeof decisions>();
            for (const d of decisions) byReviewer.set(d.reviewerId, [...(byReviewer.get(d.reviewerId) ?? []), d]);
            return (
              <li key={s.order} className={`${card} p-4`} data-testid="review-step">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">Step {s.order}: {s.name}</p>
                  <span className={`${badge} ${state === "Done" ? "bg-emerald-100 text-emerald-900" : state === "In progress" ? "bg-sky-100 text-sky-900" : "bg-muted text-ink-soft"}`}>{state}</span>
                </div>
                <p className="mt-1 text-xs text-ink-soft">
                  {parseSubjects(s.reviewers).map((x) => names.get(x) ?? "Removed").join(", ")} · {s.mode === "ALL" ? "all must respond" : "any one responds"}
                </p>
                {byReviewer.size > 0 && (
                  <ul className="mt-3 space-y-2">
                    {[...byReviewer].map(([rid, list]) => (
                      <li key={rid} className="text-sm" data-testid="step-decision">
                        <p className="font-medium">{list[0].reviewer.name} <span className="text-xs font-normal text-ink-soft">{fmt.format(list[list.length - 1].updatedAt)}</span></p>
                        <ul className="mt-1 space-y-1 pl-3">
                          {list.map((d) => (
                            <li key={d.id}>
                              <span className="break-all text-ink-soft">{docName.get(d.reviewDocumentId)}:</span>{" "}
                              <span className={`${badge} ${OUTCOME_BADGE[d.outcome as Outcome]}`}>{labelFor(statuses, d.outcome as Outcome)}</span>
                              {d.comment && <p className="mt-0.5 whitespace-pre-wrap text-ink">{d.comment}</p>}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
