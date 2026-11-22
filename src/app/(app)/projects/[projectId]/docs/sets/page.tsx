import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { SheetTable } from "@/components/docs/SheetTable";
import { btnGhost, card, input } from "@/components/ui";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getDocsContext } from "@/modules/docs/access";
import { alwaysManages } from "@/modules/docs/folder-permissions";
import { addSheetsToSet, createSet } from "@/modules/docs/sheet-actions";
import { loadSheets } from "@/modules/docs/sheet-queries";

/** All current sheets: the latest version of every sheet under Plans the member can see. */
export default async function AllSheetsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getDocsContext(projectId);
  const canSets = can(ctx.member, "DOCS", "create", ctx.grants);
  const [rows, sets] = await Promise.all([
    loadSheets(projectId, {}, true),
    db.sheetSet.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">All current sheets</h2>
          <p className="text-sm text-ink-soft">PDFs and images uploaded under Plans, one sheet per page. Numbers and titles come from the title block.</p>
        </div>
        {alwaysManages(ctx.member, ctx.grants) && (
          <Link href={`/projects/${projectId}/docs/sheets/settings`} className={btnGhost}>Title block settings</Link>
        )}
      </div>

      {canSets && (
        <div className="grid gap-3 md:grid-cols-2">
          <section className={`${card} p-4`}>
            <h3 className="mb-2 text-sm font-semibold">New set</h3>
            <ActionForm action={createSet.bind(null, projectId)} className="flex flex-wrap gap-2" testId="new-set-form">
              <input className={`${input} min-w-0 flex-1`} name="name" aria-label="Set name" placeholder="e.g. Tender, IFC Rev B" maxLength={80} required />
              <SubmitButton>Create set</SubmitButton>
            </ActionForm>
          </section>
          <section className={`${card} p-4`}>
            <h3 className="mb-2 text-sm font-semibold">Add ticked sheets to a set</h3>
            <ActionForm action={addSheetsToSet.bind(null, projectId)} id="add-to-set" className="flex flex-wrap gap-2" testId="add-to-set-form" resetOnSuccess={false}>
              <select className={`${input} min-w-0 flex-1`} name="setId" aria-label="Set" defaultValue="" required>
                <option value="" disabled>Choose a set…</option>
                {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <SubmitButton>Add to set</SubmitButton>
            </ActionForm>
          </section>
        </div>
      )}

      <SheetTable
        projectId={projectId}
        rows={rows}
        selectForm={canSets ? "add-to-set" : undefined}
        emptyText="No sheets yet. Upload PDF drawings to Plans (or a folder inside it) and each page becomes a sheet."
      />
    </div>
  );
}
