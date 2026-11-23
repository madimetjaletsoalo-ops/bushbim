import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmButton } from "@/components/docs/ConfirmButton";
import { badge, btnDanger, btnGhost, card, input, label } from "@/components/ui";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { pathUp } from "@/modules/docs/folder-permissions";
import { getDocsContext } from "@/modules/docs/access";
import { createWorkflow, deleteWorkflow, setWorkflowActive } from "@/modules/reviews/actions";
import { MAX_STEPS, OUTCOMES, OUTCOME_LABELS, parseStatuses, parseSubjects } from "@/modules/reviews/logic";

export default async function WorkflowsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const pctx = await getProjectContext(projectId);
  if (!pctx.isAdmin && !can(pctx.member, "DOCS", "manage", pctx.grants)) notFound();
  const ctx = await getDocsContext(projectId);
  const [workflows, members, roles, companies] = await Promise.all([
    db.reviewWorkflow.findMany({
      where: { projectId },
      include: { steps: { orderBy: { order: "asc" } }, _count: { select: { reviews: true } }, autoStartFolder: true, approvedFolder: true },
      orderBy: { createdAt: "asc" },
    }),
    db.projectMember.findMany({ where: { projectId }, include: { user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
    db.role.findMany({ where: { accountId: ctx.user.accountId }, orderBy: { name: "asc" } }),
    db.company.findMany({ where: { accountId: ctx.user.accountId }, orderBy: { name: "asc" } }),
  ]);
  const names = new Map<string, string>();
  for (const m of members) names.set(`USER:${m.userId}`, m.user.name);
  for (const r of roles) names.set(`ROLE:${r.id}`, `${r.name} (role)`);
  for (const c of companies) names.set(`COMPANY:${c.id}`, `${c.name} (company)`);
  const subjectNames = (raw: unknown) => parseSubjects(raw).map((s) => names.get(s) ?? "Removed");
  const folderPath = (id: string) =>
    pathUp(ctx.index, id)
      .reverse()
      .map((f) => ctx.index.byId.get(f)?.name)
      .join(" / ");
  const folders = ctx.folders.map((f) => ({ id: f.id, path: folderPath(f.id) })).sort((a, b) => a.path.localeCompare(b.path));

  const subjectOptions = (
    <>
      <optgroup label="People">
        {members.map((m) => <option key={m.userId} value={`USER:${m.userId}`}>{m.user.name}</option>)}
      </optgroup>
      {roles.length > 0 && (
        <optgroup label="Roles">
          {roles.map((r) => <option key={r.id} value={`ROLE:${r.id}`}>{r.name}</option>)}
        </optgroup>
      )}
      {companies.length > 0 && (
        <optgroup label="Companies">
          {companies.map((c) => <option key={c.id} value={`COMPANY:${c.id}`}>{c.name}</option>)}
        </optgroup>
      )}
    </>
  );
  const folderSelect = (name: string, labelText: string, help: string) => (
    <div>
      <label className={label} htmlFor={name}>{labelText}</label>
      <select className={input} id={name} name={name} defaultValue="">
        <option value="">None</option>
        {folders.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
      </select>
      <p className="mt-1 text-xs text-ink-soft">{help}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Approval workflows</h2>

      {workflows.length === 0 ? (
        <p className="text-sm text-ink-soft">No workflows yet. Define one below.</p>
      ) : (
        <ul className="space-y-3" data-testid="workflow-list">
          {workflows.map((w) => (
            <li key={w.id} className={`${card} space-y-2 p-4`} data-testid="workflow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  {w.name} {!w.active && <span className={`${badge} ml-1 bg-muted text-ink-soft`}>Inactive</span>}
                </h3>
                <div className="flex gap-2">
                  <form action={setWorkflowActive.bind(null, projectId, w.id, !w.active)}>
                    <button className={btnGhost} type="submit">{w.active ? "Deactivate" : "Activate"}</button>
                  </form>
                  {w._count.reviews === 0 && (
                    <form action={deleteWorkflow.bind(null, projectId, w.id)}>
                      <ConfirmButton className={`${btnDanger} py-2`} message={`Delete the workflow "${w.name}"?`}>Delete</ConfirmButton>
                    </form>
                  )}
                </div>
              </div>
              {w.description && <p className="text-sm text-ink-soft">{w.description}</p>}
              <ol className="space-y-1 text-sm">
                {w.steps.map((s) => (
                  <li key={s.id}>
                    <span className="font-medium">Step {s.order}: {s.name}</span>{" "}
                    <span className="text-ink-soft">
                      · {subjectNames(s.reviewers).join(", ")} · {s.mode === "ALL" ? "all must respond" : "any one responds"} · {s.days} {s.days === 1 ? "day" : "days"}
                    </span>
                  </li>
                ))}
              </ol>
              <dl className="grid gap-x-4 gap-y-1 text-xs text-ink-soft sm:grid-cols-2">
                <div><dt className="inline font-medium">Statuses: </dt><dd className="inline">{parseStatuses(w.statuses).map((s) => s.label).join(", ")}</dd></div>
                <div><dt className="inline font-medium">Initiators: </dt><dd className="inline">{subjectNames(w.initiators).join(", ") || "Any Document Control Creator"}</dd></div>
                <div><dt className="inline font-medium">Starts on upload to: </dt><dd className="inline">{w.autoStartFolderId ? folderPath(w.autoStartFolderId) : "—"}</dd></div>
                <div><dt className="inline font-medium">Approved files copied to: </dt><dd className="inline">{w.approvedFolderId ? folderPath(w.approvedFolderId) : "—"}</dd></div>
                <div><dt className="inline font-medium">Reviews: </dt><dd className="inline">{w._count.reviews}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      <section className={`${card} p-4`}>
        <h3 className="mb-3 font-semibold">New workflow</h3>
        <ActionForm action={createWorkflow.bind(null, projectId)} className="space-y-5" testId="workflow-form">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="wf-name">Workflow name</label>
              <input className={input} id="wf-name" name="name" required maxLength={100} placeholder="e.g. Two-step design approval" />
            </div>
            <div>
              <label className={label} htmlFor="wf-description">Description</label>
              <input className={input} id="wf-description" name="description" maxLength={500} />
            </div>
          </div>

          <fieldset>
            <legend className={label}>Approval statuses</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {OUTCOMES.map((code) => (
                <div key={code} className="flex items-center gap-2">
                  <input type="checkbox" name={`status_${code}`} id={`status_${code}`} defaultChecked aria-label={`Use ${OUTCOME_LABELS[code]}`} />
                  <input className={input} name={`label_${code}`} defaultValue={OUTCOME_LABELS[code]} maxLength={60} aria-label={`Label for ${OUTCOME_LABELS[code]}`} />
                </div>
              ))}
            </div>
          </fieldset>

          {Array.from({ length: MAX_STEPS }, (_, i) => i + 1).map((n) => (
            <fieldset key={n} className="rounded-md border border-line p-3" data-testid={`step-${n}`}>
              <legend className="px-1 text-sm font-semibold">Step {n}{n > 1 && <span className="font-normal text-ink-soft"> (optional)</span>}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor={`step${n}Name`}>Step {n} name</label>
                  <input className={input} id={`step${n}Name`} name={`step${n}Name`} maxLength={100} required={n === 1} placeholder={n === 1 ? "e.g. Design review" : "Leave empty to skip"} />
                </div>
                <div>
                  <label className={label} htmlFor={`step${n}Reviewers`}>Step {n} reviewers</label>
                  <select className={`${input} h-24`} id={`step${n}Reviewers`} name={`step${n}Reviewers`} multiple>
                    {subjectOptions}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor={`step${n}Mode`}>Step {n} completes when</label>
                  <select className={input} id={`step${n}Mode`} name={`step${n}Mode`} defaultValue="ANY">
                    <option value="ANY">Any one reviewer responds</option>
                    <option value="ALL">All reviewers respond</option>
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor={`step${n}Days`}>Step {n} days to review</label>
                  <input className={input} id={`step${n}Days`} name={`step${n}Days`} type="number" min={1} max={60} defaultValue={5} />
                </div>
              </div>
            </fieldset>
          ))}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="initiators">Who can start reviews</label>
              <select className={`${input} h-24`} id="initiators" name="initiators" multiple>
                {subjectOptions}
              </select>
              <p className="mt-1 text-xs text-ink-soft">None selected: any Document Control Creator.</p>
            </div>
            {folderSelect("autoStartFolderId", "Start automatically on upload to", "Each new file or version uploaded here starts a review.")}
            {folderSelect("approvedFolderId", "Copy approved files to", "When the review closes, approved files are copied here as a new version.")}
          </div>
          <SubmitButton>Create workflow</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
