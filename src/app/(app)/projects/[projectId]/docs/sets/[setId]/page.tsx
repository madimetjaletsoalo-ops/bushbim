import { notFound } from "next/navigation";
import { SheetTable } from "@/components/docs/SheetTable";
import { ConfirmButton } from "@/components/docs/ConfirmButton";
import { btnDanger } from "@/components/ui";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getDocsContext } from "@/modules/docs/access";
import { deleteSet } from "@/modules/docs/sheet-actions";
import { loadSheets } from "@/modules/docs/sheet-queries";

/** One set: the exact sheet versions grouped under it (they don't move when newer versions arrive). */
export default async function SetPage({ params }: { params: Promise<{ projectId: string; setId: string }> }) {
  const { projectId, setId } = await params;
  const ctx = await getDocsContext(projectId);
  const set = await db.sheetSet.findFirst({ where: { id: setId, projectId } });
  if (!set) notFound();
  const rows = await loadSheets(projectId, { sets: { some: { setId } } }, false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-soft">Set</p>
          <h2 className="text-xl font-semibold">{set.name}</h2>
          <p className="text-sm text-ink-soft">{rows.length} sheet{rows.length === 1 ? "" : "s"}. A set keeps the versions it was given, even after newer versions are uploaded.</p>
        </div>
        {can(ctx.member, "DOCS", "manage", ctx.grants) && (
          <form action={deleteSet.bind(null, projectId, setId)}>
            <ConfirmButton className={`${btnDanger} py-2`} message={`Delete the set "${set.name}"? The sheets themselves are kept.`}>Delete set</ConfirmButton>
          </form>
        )}
      </div>
      <SheetTable
        projectId={projectId}
        rows={rows}
        inSet={setId}
        canChangeSets={can(ctx.member, "DOCS", "create", ctx.grants)}
        emptyText="This set is empty. Go to All current sheets, tick sheets and add them here."
      />
    </div>
  );
}
