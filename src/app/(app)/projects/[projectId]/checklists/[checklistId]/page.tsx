import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { ChecklistFields } from "@/components/checklists/ChecklistFields";
import { SignaturePad } from "@/components/checklists/SignaturePad";
import { ConfirmButton } from "@/components/docs/ConfirmButton";
import { PhotoUploader } from "@/components/issues/PhotoUploader";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, btn, btnGhost, card, input } from "@/components/ui";
import { answerItem, completeChecklist, deleteChecklist, raiseIssueFromItem, reopenChecklist, updateChecklistDetails } from "@/modules/checklists/actions";
import { deleteChecklistPhoto } from "@/modules/checklists/media-actions";
import { KIND_LABELS, LIMITS, STATUS_COLORS, STATUS_LABELS, YES_NO, YES_NO_LABELS, answerText, checklistLabel, isAnswered, isFailed, progress } from "@/modules/checklists/logic";
import { accessFor, getChecklistsContext, loadChecklistFull, type ChecklistFull } from "@/modules/checklists/server";
import { isOverdue, issueLabel } from "@/modules/issues/logic";

type Item = ChecklistFull["sections"][number]["items"][number];

const YES_NO_STYLE: Record<string, string> = {
  YES: "border-emerald-600 bg-emerald-600 text-white",
  NO: "border-red-600 bg-red-600 text-white",
  NA: "border-gray-500 bg-gray-500 text-white",
};

export default async function ChecklistPage({ params }: { params: Promise<{ projectId: string; checklistId: string }> }) {
  const { projectId, checklistId } = await params;
  const ctx = await getChecklistsContext(projectId);
  const c = await loadChecklistFull(projectId, checklistId);
  if (!c) notFound();
  const access = accessFor(ctx, c);
  if (!access.see) notFound();

  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.project.timezone });
  const day = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "UTC" });
  const p = progress(c.sections.flatMap((s) => s.items.map((i) => ({ ...i, photoCount: i.photos.length }))));
  const location = c.locationId ? ctx.locationPaths.find((l) => l.id === c.locationId)?.path : null;
  const assignee = ctx.assigneeName(c.assigneeType, c.assigneeId);
  const overdue = isOverdue(c.dueDate, c.status === "COMPLETED", ctx.project.timezone);
  const base = `/projects/${projectId}/checklists`;
  const color = STATUS_COLORS[c.status];

  return (
    <div className="space-y-4">
      <Link href={base} className="text-sm text-ink-soft hover:underline">← Checklists</Link>

      <header className={`${card} space-y-3 border-l-4 p-5`} style={{ borderLeftColor: color }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink-soft">
              {checklistLabel(c.number)} · {c.templateName}
            </p>
            <h2 className="text-xl font-semibold break-words">{c.title}</h2>
          </div>
          <span className={badge} style={{ background: `${color}22`, boxShadow: `inset 0 0 0 1px ${color}` }} data-testid="checklist-status">
            {STATUS_LABELS[c.status]}
          </span>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-ink-soft">Assigned to</dt><dd data-testid="checklist-assignee">{assignee ?? "Unassigned"}</dd></div>
          <div><dt className="text-xs text-ink-soft">Location</dt><dd data-testid="checklist-location">{location ?? "—"}</dd></div>
          <div>
            <dt className="text-xs text-ink-soft">Due</dt>
            <dd className={overdue ? "font-medium text-red-700" : ""}>{c.dueDate ? `${day.format(c.dueDate)}${overdue ? " (overdue)" : ""}` : "—"}</dd>
          </div>
          <div><dt className="text-xs text-ink-soft">Created</dt><dd>{fmt.format(c.createdAt)} by {c.createdBy?.name ?? "former member"}</dd></div>
        </dl>
        <div>
          <div className="h-2 w-full rounded-full bg-muted" aria-hidden>
            <div className="h-2 rounded-full bg-brand" style={{ width: `${p.percent}%` }} />
          </div>
          <p className="mt-1 text-sm text-ink-soft" data-testid="checklist-progress">
            {p.answered} of {p.total} answered
            {p.failed > 0 && <span className="text-red-700"> · {p.failed} failed</span>}
            {p.missing.length > 0 && c.status !== "COMPLETED" && ` · ${p.missing.length} required left`}
          </p>
        </div>
        {c.status === "COMPLETED" && c.completedAt && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="completed-note">
            Completed by {c.completedBy?.name ?? "former member"} on {fmt.format(c.completedAt)}.
          </p>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <a href={`/api/projects/${projectId}/checklists/${c.id}/pdf`} className={btnGhost} data-testid="checklist-pdf">Download PDF</a>
          {access.complete && (
            <ActionForm action={completeChecklist.bind(null, projectId, c.id)} testId="complete-form">
              <SubmitButton>Complete checklist</SubmitButton>
            </ActionForm>
          )}
          {access.reopen && (
            <form action={reopenChecklist.bind(null, projectId, c.id)}>
              <ConfirmButton message="Reopen this checklist so its answers can change?" className={btnGhost}>Reopen</ConfirmButton>
            </form>
          )}
          {access.delete && (
            <form action={deleteChecklist.bind(null, projectId, c.id)} className="ml-auto">
              <ConfirmButton message="Delete this checklist with its answers and photos? Issues raised from it stay." className={`${btnGhost} text-red-700`}>Delete</ConfirmButton>
            </form>
          )}
        </div>
        {access.edit && (
          <details className="rounded-md border border-line">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">Edit details</summary>
            <ActionForm action={updateChecklistDetails.bind(null, projectId, c.id)} resetOnSuccess={false} className="space-y-3 border-t border-line p-3" testId="details-form">
              <ChecklistFields ctx={ctx} idPrefix="edit" defaults={c} />
              <SubmitButton>Save details</SubmitButton>
            </ActionForm>
          </details>
        )}
      </header>

      {!access.answer && c.status !== "COMPLETED" && (
        <p className="text-sm text-ink-soft" data-testid="read-only-note">Only the assignee, the checklist&apos;s creator or a Checklists Manager can answer this checklist.</p>
      )}

      {c.sections.map((s) => (
        <section key={s.id} className={card} data-testid="checklist-section">
          <h3 className="border-b border-line px-4 py-3 font-semibold">{s.title}</h3>
          <ol className="divide-y divide-line">
            {s.items.map((i) => (
              <ItemRow key={i.id} item={i} projectId={projectId} checklistId={c.id} canAnswer={access.answer} canRaise={ctx.canRaiseIssues} fmt={fmt} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function ItemRow({ item: i, projectId, checklistId, canAnswer, canRaise, fmt }: { item: Item; projectId: string; checklistId: string; canAnswer: boolean; canRaise: boolean; fmt: Intl.DateTimeFormat }) {
  const answer = answerItem.bind(null, projectId, checklistId, i.id);
  const done = isAnswered({ ...i, photoCount: i.photos.length });
  const failed = isFailed(i);
  const text = answerText({ ...i, photoCount: i.photos.length });
  return (
    <li className={`space-y-2 px-4 py-3 ${failed ? "bg-red-50/60" : ""}`} data-testid="checklist-item" data-kind={i.kind}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-sm font-medium break-words">
          {i.label}
          {i.required && <span className="text-red-700" title="Required"> *</span>}
        </p>
        <p className="text-xs text-ink-soft">
          {KIND_LABELS[i.kind]}
          {done ? <span className="ml-2 text-emerald-700" aria-label="Answered">✓</span> : null}
        </p>
      </div>

      {i.kind === "YES_NO" &&
        (canAnswer ? (
          <ActionForm action={answer} resetOnSuccess={false} testId="yes-no-form">
            <div className="flex gap-2" role="group" aria-label={`Answer: ${i.label}`}>
              {YES_NO.map((v) => (
                <button
                  key={v}
                  type="submit"
                  name="value"
                  value={v}
                  aria-pressed={i.value === v}
                  className={`min-w-14 rounded-md border px-3 py-2 text-sm font-medium ${i.value === v ? YES_NO_STYLE[v] : "border-line bg-surface hover:bg-muted"}`}
                >
                  {YES_NO_LABELS[v]}
                </button>
              ))}
            </div>
          </ActionForm>
        ) : (
          <Answer text={text} failed={failed} />
        ))}

      {(i.kind === "TEXT" || i.kind === "NUMBER" || i.kind === "DATE") &&
        (canAnswer ? (
          <ActionForm action={answer} resetOnSuccess={false} className="flex max-w-xl flex-wrap items-start gap-2" testId="value-form">
            {i.kind === "TEXT" ? (
              <textarea name="value" className={`${input} min-w-0 flex-1`} rows={2} maxLength={LIMITS.text} defaultValue={i.value ?? ""} aria-label={`Answer: ${i.label}`} />
            ) : (
              <input
                name="value"
                className={`${input} min-w-0 flex-1`}
                type={i.kind === "DATE" ? "date" : "text"}
                inputMode={i.kind === "NUMBER" ? "decimal" : undefined}
                defaultValue={i.value ?? ""}
                aria-label={`Answer: ${i.label}`}
              />
            )}
            <SubmitButton className={btnGhost}>Save</SubmitButton>
          </ActionForm>
        ) : (
          <Answer text={text} />
        ))}

      {i.kind === "SIGNATURE" &&
        (i.value ? (
          <div className="flex flex-wrap items-end gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.value} alt={`Signature for ${i.label}`} width={240} height={80} className="rounded border border-line bg-white" data-testid="signature-image" />
            {canAnswer && (
              <ActionForm action={answer}>
                <input type="hidden" name="value" value="" />
                <button type="submit" className="text-sm font-medium text-red-700 hover:underline">Clear signature</button>
              </ActionForm>
            )}
          </div>
        ) : canAnswer ? (
          <ActionForm action={answer} testId="signature-form">
            <SignaturePad label={`Sign: ${i.label}`} />
          </ActionForm>
        ) : (
          <Answer text="" />
        ))}

      {i.kind === "PHOTO" && (
        <div className="space-y-2">
          {i.photos.length > 0 ? (
            <ul className="flex flex-wrap gap-2" data-testid="item-photos">
              {i.photos.map((ph) => (
                <li key={ph.id} className="w-28 text-xs">
                  <a href={`/api/projects/${projectId}/photos/${ph.id}`} target="_blank" rel="noopener" className="block aspect-[4/3] overflow-hidden rounded border border-line bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/projects/${projectId}/photos/${ph.id}?size=thumb`} alt={ph.caption ?? ph.fileName} loading="lazy" className="h-full w-full object-cover" />
                  </a>
                  {canAnswer && (
                    <form action={deleteChecklistPhoto.bind(null, projectId, checklistId, ph.id)}>
                      <ConfirmButton message="Remove this photo?" className="mt-0.5 font-medium text-red-700 hover:underline">Remove</ConfirmButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            !canAnswer && <Answer text="" />
          )}
          {canAnswer && <PhotoUploader projectId={projectId} issueId={null} checklistItem={{ checklistId, itemId: i.id }} label="Add photo" />}
        </div>
      )}

      {failed && (
        <div className="space-y-2">
          {canAnswer ? (
            <ActionForm action={answer} resetOnSuccess={false} className="flex max-w-xl flex-wrap items-start gap-2" testId="note-form">
              <input type="hidden" name="value" value={i.value ?? ""} />
              <input name="note" className={`${input} min-w-0 flex-1`} maxLength={LIMITS.note} defaultValue={i.note ?? ""} aria-label={`Note: ${i.label}`} placeholder="What's wrong? (copied to the issue)" />
              <SubmitButton className={btnGhost}>Save note</SubmitButton>
            </ActionForm>
          ) : (
            i.note && <p className="text-sm">Note: {i.note}</p>
          )}
          {i.issue ? (
            <p className="text-sm" data-testid="raised-issue">
              Issue raised:{" "}
              <Link href={`/projects/${projectId}/issues/${i.issue.id}`} className="font-medium text-brand hover:underline">
                {issueLabel(i.issue.number)}
              </Link>{" "}
              <span className={badge} style={{ background: `${i.issue.status.color}22`, boxShadow: `inset 0 0 0 1px ${i.issue.status.color}` }}>{i.issue.status.name}</span>
            </p>
          ) : (
            canRaise && (
              <ActionForm action={raiseIssueFromItem.bind(null, projectId, checklistId, i.id)} testId="raise-issue-form">
                <SubmitButton className={`${btn} bg-red-700 hover:bg-red-800`}>Raise issue</SubmitButton>
              </ActionForm>
            )
          )}
        </div>
      )}

      {i.answeredAt && (
        <p className="text-xs text-ink-soft" data-testid="answered-by">
          {i.answeredBy?.name ?? "Former member"} · {fmt.format(i.answeredAt)}
        </p>
      )}
    </li>
  );
}

function Answer({ text, failed }: { text: string; failed?: boolean }) {
  return text ? <p className={`text-sm font-medium ${failed ? "text-red-700" : ""}`}>{text}</p> : <p className="text-sm text-ink-soft">Not answered</p>;
}
