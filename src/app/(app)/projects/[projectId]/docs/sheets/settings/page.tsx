import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { btnGhost, card, input, label } from "@/components/ui";
import { getDocsContext } from "@/modules/docs/access";
import { alwaysManages } from "@/modules/docs/folder-permissions";
import { rebuildSheets, saveTitleBlock } from "@/modules/docs/sheet-actions";
import { titleBlockRegions } from "@/modules/docs/sheets-server";
import type { Region } from "@/modules/docs/sheets";

const pct = (v: number) => +(v * 100).toFixed(1);

function RegionFields({ prefix, name, r }: { prefix: string; name: string; r: Region }) {
  const fields: [string, string, number][] = [
    ["X", "From left %", r.x],
    ["Y", "From top %", r.y],
    ["W", "Width %", r.w],
    ["H", "Height %", r.h],
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{name}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fields.map(([k, l, v]) => (
          <div key={k}>
            <label className={label} htmlFor={`${prefix}${k}`}>{l}</label>
            <input className={input} id={`${prefix}${k}`} name={`${prefix}${k}`} type="number" min={0} max={100} step={0.1} defaultValue={pct(v)} required />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/** Where the sheet number and title are read from on each page. */
export default async function TitleBlockSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getDocsContext(projectId);
  if (!alwaysManages(ctx.member, ctx.grants)) notFound();
  const regions = await titleBlockRegions(projectId);
  const box = (r: Region, color: string, text: string) => (
    <div
      className="absolute flex items-center justify-center border-2 text-[10px] font-semibold"
      style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, borderColor: color, color, background: `${color}14` }}
    >
      {text}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Title block settings</h2>
          <p className="text-sm text-ink-soft">Where BushBIM reads each sheet&apos;s number and title, as a percentage of the page. Applies to every PDF uploaded to Plans.</p>
        </div>
        <Link href={`/projects/${projectId}/docs/sets`} className={btnGhost}>← Sheets</Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section className={`${card} space-y-4 p-4`}>
          <ActionForm action={saveTitleBlock.bind(null, projectId)} className="space-y-4" resetOnSuccess={false} testId="titleblock-form">
            <RegionFields prefix="number" name="Sheet number box" r={regions.number} />
            <RegionFields prefix="title" name="Sheet title box" r={regions.title} />
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
          <div className="border-t border-line pt-4">
            <p className="mb-2 text-sm text-ink-soft">Apply the boxes to sheets already uploaded. Sheets someone edited by hand keep their edits.</p>
            <ActionForm action={rebuildSheets.bind(null, projectId)} testId="rebuild-form">
              <SubmitButton>Re-read all sheets</SubmitButton>
            </ActionForm>
          </div>
        </section>
        <section className={`${card} p-4`} aria-label="Preview">
          <p className="mb-2 text-sm font-semibold">Preview (landscape sheet)</p>
          <div className="relative aspect-[1.414] w-full border border-ink/40 bg-white" data-testid="titleblock-preview">
            <div className="absolute inset-[3%] border border-ink/20" />
            {box(regions.title, "#1565c0", "Title")}
            {box(regions.number, "#d32f2f", "No.")}
          </div>
          <p className="mt-2 text-xs text-ink-soft">Text whose centre falls inside a box is read, line by line. If a box is empty on a page, the sheet is named after the file and page, and can be edited.</p>
        </section>
      </div>
    </div>
  );
}
