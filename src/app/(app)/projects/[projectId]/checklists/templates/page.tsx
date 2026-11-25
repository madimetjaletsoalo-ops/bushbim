import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, card, input, label, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { createTemplate, setTemplateArchived } from "@/modules/checklists/actions";
import { getChecklistsContext } from "@/modules/checklists/server";

export default async function TemplatesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getChecklistsContext(projectId);
  if (!ctx.canManage)
    return <div className={`${card} p-6 text-sm text-ink-soft`}>Building checklist templates needs Checklists Manager access.</div>;
  const templates = await db.checklistTemplate.findMany({
    where: { projectId },
    include: { sections: { select: { _count: { select: { items: true } } } }, _count: { select: { checklists: true } } },
    orderBy: [{ archived: "asc" }, { name: "asc" }],
  });
  const base = `/projects/${projectId}/checklists/templates`;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Checklist templates</h2>
        <p className="text-sm text-ink-soft">Checklists copy their template when created, so editing a template changes only checklists made after.</p>
      </div>

      <section className={`${card} p-4`}>
        <h3 className="mb-3 text-sm font-semibold">New template</h3>
        <ActionForm action={createTemplate.bind(null, projectId)} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end" testId="new-template-form">
          <div>
            <label className={label} htmlFor="tpl-name">Template name</label>
            <input className={input} id="tpl-name" name="name" required maxLength={120} placeholder="e.g. Boma kitchen handover" />
          </div>
          <div>
            <label className={label} htmlFor="tpl-desc">Description (optional)</label>
            <input className={input} id="tpl-desc" name="description" maxLength={500} />
          </div>
          <SubmitButton>Create template</SubmitButton>
        </ActionForm>
      </section>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full" data-testid="templates-table">
          <thead className="border-b border-line bg-muted/50">
            <tr>
              <th className={th}>Template</th>
              <th className={th}>Items</th>
              <th className={`${th} hidden sm:table-cell`}>Used</th>
              <th className={th}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {templates.map((t) => (
              <tr key={t.id} data-testid="template-row" className={t.archived ? "opacity-60" : ""}>
                <td className={td}>
                  <Link href={`${base}/${t.id}`} className="font-medium break-words hover:underline">{t.name}</Link>
                  {t.archived && <span className={`${badge} ml-2 bg-muted text-ink-soft`}>Archived</span>}
                  {t.description && <p className="text-xs text-ink-soft">{t.description}</p>}
                </td>
                <td className={td}>
                  {t.sections.reduce((n, s) => n + s._count.items, 0)} in {t.sections.length} section{t.sections.length === 1 ? "" : "s"}
                </td>
                <td className={`${td} hidden sm:table-cell`}>{t._count.checklists}</td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <form action={setTemplateArchived.bind(null, projectId, t.id, !t.archived)}>
                    <button type="submit" className="text-sm font-medium text-brand hover:underline">{t.archived ? "Restore" : "Archive"}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
