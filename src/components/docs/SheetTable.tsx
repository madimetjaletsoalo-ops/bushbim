import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, btnDanger, card, input, td, th } from "@/components/ui";
import { removeSheetFromSet, updateSheet } from "@/modules/docs/sheet-actions";
import type { SheetRow } from "@/modules/docs/sheet-queries";

/** Sheets list. With `selectForm`, each row gets a checkbox that joins that form (bulk add to set). */
export function SheetTable({
  projectId,
  rows,
  selectForm,
  inSet,
  canChangeSets,
  emptyText,
}: {
  projectId: string;
  rows: SheetRow[];
  selectForm?: string;
  inSet?: string;
  canChangeSets?: boolean;
  emptyText: string;
}) {
  if (!rows.length) return <div className={`${card} p-8 text-center text-sm text-ink-soft`}>{emptyText}</div>;
  return (
    <div className={card}>
      <table className="w-full table-fixed" data-testid="sheet-table">
        <thead className="border-b border-line bg-muted/50">
          <tr>
            {selectForm && <th className={`${th} w-10 px-3`}><span className="sr-only">Select</span></th>}
            <th className={`${th} w-28 sm:w-36`}>Sheet</th>
            <th className={th}>Title</th>
            <th className={`${th} hidden w-20 md:table-cell`}>Version</th>
            <th className={`${th} hidden w-40 lg:table-cell`}>Sets</th>
            <th className={`${th} w-24 sm:w-40`}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id} data-testid="sheet-row">
              {selectForm && (
                <td className={`${td} px-3`}>
                  <input type="checkbox" name="sheetIds" value={r.id} form={selectForm} className="h-4 w-4 accent-brand" aria-label={`Select ${r.number}`} />
                </td>
              )}
              <td className={`${td} break-words`}>
                <Link href={r.viewHref} className="font-mono text-sm font-semibold text-brand hover:underline" data-testid="sheet-number">{r.number}</Link>
                <p className="mt-0.5 text-xs text-ink-soft md:hidden">V{r.versionNumber}{r.isCurrent ? "" : " (older)"}</p>
              </td>
              <td className={`${td} break-words`}>
                <span data-testid="sheet-title">{r.title}</span>
                <p className="mt-0.5 truncate text-xs text-ink-soft" title={r.docName}>{r.docName} · page {r.page}</p>
                {r.canEdit && (
                  <details className="mt-1">
                    <summary className="cursor-pointer list-none text-xs font-medium text-brand hover:underline">Edit</summary>
                    <ActionForm action={updateSheet.bind(null, projectId, r.id)} resetOnSuccess={false} className="mt-2 grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto]" testId="sheet-edit-form">
                      <input className={input} name="number" defaultValue={r.number} aria-label="Sheet number" maxLength={60} required />
                      <input className={input} name="title" defaultValue={r.title} aria-label="Sheet title" maxLength={200} required />
                      <SubmitButton>Save</SubmitButton>
                    </ActionForm>
                  </details>
                )}
              </td>
              <td className={`${td} hidden md:table-cell`}>
                <span className={`${badge} ${r.isCurrent ? "bg-brand/10 text-brand" : "bg-muted text-ink-soft"}`}>V{r.versionNumber}</span>
              </td>
              <td className={`${td} hidden lg:table-cell`}>
                <div className="flex flex-wrap gap-1">
                  {r.sets.map((s) => <span key={s.id} className={`${badge} bg-accent/15 text-ink`}>{s.name}</span>)}
                </div>
              </td>
              <td className={`${td} text-right`}>
                <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:gap-3">
                  {r.compareHref && (
                    <Link href={r.compareHref} className="text-xs font-medium text-brand hover:underline" aria-label={`Compare ${r.number} with the previous version`}>
                      Compare
                    </Link>
                  )}
                  {inSet && canChangeSets && (
                    <form action={removeSheetFromSet.bind(null, projectId, inSet, r.id)}>
                      <button className={`${btnDanger} px-0 py-0 text-xs`} aria-label={`Remove ${r.number} from this set`}>Remove</button>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
