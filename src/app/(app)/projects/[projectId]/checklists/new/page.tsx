import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { ChecklistFields } from "@/components/checklists/ChecklistFields";
import { SubmitButton } from "@/components/SubmitButton";
import { card, input, label } from "@/components/ui";
import { db } from "@/lib/db";
import { createChecklist } from "@/modules/checklists/actions";
import { getChecklistsContext } from "@/modules/checklists/server";

export default async function NewChecklistPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ template?: string }> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const ctx = await getChecklistsContext(projectId);
  if (!ctx.canCreate)
    return (
      <div className={`${card} p-6 text-sm text-ink-soft`} data-testid="cannot-create">
        Creating checklists needs Checklists Creator access. Ask a project admin.
      </div>
    );
  const templates = await db.checklistTemplate.findMany({
    where: { projectId, archived: false },
    include: { sections: { select: { _count: { select: { items: true } } } } },
    orderBy: { name: "asc" },
  });
  const usable = templates.filter((t) => t.sections.some((s) => s._count.items));
  return (
    <div className="space-y-4">
      <Link href={`/projects/${projectId}/checklists`} className="text-sm text-ink-soft hover:underline">← Checklists</Link>
      <h2 className="text-xl font-semibold">New checklist</h2>
      <section className={`${card} p-5`}>
        {usable.length === 0 ? (
          <p className="text-sm text-ink-soft">There are no templates with items yet. A Checklists Manager can build one under Templates.</p>
        ) : (
          <ActionForm action={createChecklist.bind(null, projectId)} resetOnSuccess={false} testId="checklist-form" className="space-y-4">
            <div>
              <label className={label} htmlFor="new-template">Template</label>
              <select className={input} id="new-template" name="templateId" required defaultValue={usable.some((t) => t.id === sp.template) ? sp.template : ""}>
                <option value="" disabled>Choose a template…</option>
                {usable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.sections.reduce((n, s) => n + s._count.items, 0)} items)
                  </option>
                ))}
              </select>
            </div>
            <ChecklistFields ctx={ctx} idPrefix="new" titlePlaceholder="Defaults to the template name, e.g. Villa 7 handover" />
            <SubmitButton>Create checklist</SubmitButton>
          </ActionForm>
        )}
      </section>
    </div>
  );
}
