import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/docs/ConfirmButton";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, btn, btnGhost, card, input, label } from "@/components/ui";
import { db } from "@/lib/db";
import { addItem, addSection, deleteItem, deleteSection, moveItem, moveSection, renameSection, setTemplateArchived, updateItem, updateTemplate } from "@/modules/checklists/actions";
import { ITEM_KINDS, KIND_LABELS } from "@/modules/checklists/logic";
import { getChecklistsContext } from "@/modules/checklists/server";

const small = "rounded px-1.5 py-0.5 text-xs text-ink-soft hover:bg-muted disabled:opacity-30";

function KindSelect({ id, value }: { id: string; value?: string }) {
  return (
    <select className={input} id={id} name="kind" defaultValue={value ?? "YES_NO"}>
      {ITEM_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
    </select>
  );
}

export default async function TemplateBuilderPage({ params }: { params: Promise<{ projectId: string; templateId: string }> }) {
  const { projectId, templateId } = await params;
  const ctx = await getChecklistsContext(projectId);
  if (!ctx.canManage) notFound();
  const t = await db.checklistTemplate.findFirst({
    where: { id: templateId, projectId },
    include: { sections: { orderBy: { order: "asc" }, include: { items: { orderBy: { order: "asc" } } } }, _count: { select: { checklists: true } } },
  });
  if (!t) notFound();
  const items = t.sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="space-y-4">
      <Link href={`/projects/${projectId}/checklists/templates`} className="text-sm text-ink-soft hover:underline">← Templates</Link>
      <section className={`${card} space-y-3 p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold break-words" data-testid="template-name">{t.name}</h2>
          <div className="flex items-center gap-2">
            {t.archived && <span className={`${badge} bg-muted text-ink-soft`}>Archived</span>}
            {!t.archived && items > 0 && <Link href={`/projects/${projectId}/checklists/new?template=${t.id}`} className={btn}>Use template</Link>}
            <form action={setTemplateArchived.bind(null, projectId, t.id, !t.archived)}>
              <button type="submit" className={btnGhost}>{t.archived ? "Restore" : "Archive"}</button>
            </form>
          </div>
        </div>
        <p className="text-sm text-ink-soft">
          {items} item{items === 1 ? "" : "s"} in {t.sections.length} section{t.sections.length === 1 ? "" : "s"} · used by {t._count.checklists} checklist{t._count.checklists === 1 ? "" : "s"}. Changes apply to checklists created from now on.
        </p>
        <details>
          <summary className="cursor-pointer select-none text-sm font-medium">Rename or describe</summary>
          <ActionForm action={updateTemplate.bind(null, projectId, t.id)} resetOnSuccess={false} className="mt-2 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <div>
              <label className={label} htmlFor="tpl-name">Template name</label>
              <input className={input} id="tpl-name" name="name" required maxLength={120} defaultValue={t.name} />
            </div>
            <div>
              <label className={label} htmlFor="tpl-desc">Description</label>
              <input className={input} id="tpl-desc" name="description" maxLength={500} defaultValue={t.description ?? ""} />
            </div>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </details>
      </section>

      {t.sections.map((s, si) => (
        <section key={s.id} className={card} data-testid="template-section">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <ActionForm action={renameSection.bind(null, projectId, t.id, s.id)} resetOnSuccess={false} className="flex min-w-0 flex-1 gap-2">
              <input className={`${input} font-semibold`} name="title" defaultValue={s.title} required maxLength={120} aria-label={`Section title ${s.title}`} />
              <SubmitButton className={btnGhost}>Rename</SubmitButton>
            </ActionForm>
            <div className="flex items-center gap-1">
              <form action={moveSection.bind(null, projectId, t.id, s.id, "up")}>
                <button type="submit" className={small} disabled={si === 0} aria-label={`Move section ${s.title} up`}>↑</button>
              </form>
              <form action={moveSection.bind(null, projectId, t.id, s.id, "down")}>
                <button type="submit" className={small} disabled={si === t.sections.length - 1} aria-label={`Move section ${s.title} down`}>↓</button>
              </form>
              <form action={deleteSection.bind(null, projectId, t.id, s.id)}>
                <ConfirmButton message={`Delete section "${s.title}" and its ${s.items.length} items?`} className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50">
                  Delete section
                </ConfirmButton>
              </form>
            </div>
          </div>
          <ol className="divide-y divide-line">
            {s.items.map((it, ii) => (
              <li key={it.id} className="flex flex-wrap items-end gap-2 px-4 py-2" data-testid="template-item">
                <ActionForm action={updateItem.bind(null, projectId, t.id, it.id)} resetOnSuccess={false} className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_11rem_auto_auto] sm:items-center">
                  <input className={input} name="label" defaultValue={it.label} required maxLength={300} aria-label={`Item ${it.label}`} />
                  <KindSelect id={`kind-${it.id}`} value={it.kind} />
                  <label className="inline-flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="required" defaultChecked={it.required} className="accent-brand" /> Required
                  </label>
                  <SubmitButton className={btnGhost}>Save</SubmitButton>
                </ActionForm>
                <div className="flex items-center gap-1 pb-1">
                  <form action={moveItem.bind(null, projectId, t.id, it.id, "up")}>
                    <button type="submit" className={small} disabled={ii === 0} aria-label={`Move ${it.label} up`}>↑</button>
                  </form>
                  <form action={moveItem.bind(null, projectId, t.id, it.id, "down")}>
                    <button type="submit" className={small} disabled={ii === s.items.length - 1} aria-label={`Move ${it.label} down`}>↓</button>
                  </form>
                  <form action={deleteItem.bind(null, projectId, t.id, it.id)}>
                    <button type="submit" className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50" aria-label={`Delete ${it.label}`}>Delete</button>
                  </form>
                </div>
              </li>
            ))}
          </ol>
          <ActionForm action={addItem.bind(null, projectId, t.id, s.id)} className="grid gap-2 border-t border-line bg-muted/30 px-4 py-3 sm:grid-cols-[1fr_11rem_auto_auto] sm:items-end" testId="add-item-form">
            <div>
              <label className={label} htmlFor={`new-item-${s.id}`}>New item</label>
              <input className={input} id={`new-item-${s.id}`} name="label" required maxLength={300} placeholder="e.g. Shower glass free of scratches" />
            </div>
            <div>
              <label className={label} htmlFor={`new-kind-${s.id}`}>Answer</label>
              <KindSelect id={`new-kind-${s.id}`} />
            </div>
            <label className="inline-flex items-center gap-1.5 pb-2 text-sm">
              <input type="checkbox" name="required" className="accent-brand" /> Required
            </label>
            <SubmitButton className={btnGhost}>Add item</SubmitButton>
          </ActionForm>
        </section>
      ))}

      <section className={`${card} p-4`}>
        <ActionForm action={addSection.bind(null, projectId, t.id)} className="flex flex-wrap items-end gap-2" testId="add-section-form">
          <div className="min-w-0 flex-1">
            <label className={label} htmlFor="new-section">New section</label>
            <input className={input} id="new-section" name="title" required maxLength={120} placeholder="e.g. Kitchen" />
          </div>
          <SubmitButton>Add section</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
