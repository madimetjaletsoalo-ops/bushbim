import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/docs/ConfirmButton";
import { SubmitButton } from "@/components/SubmitButton";
import { btnDanger, btnGhost, card, input, label } from "@/components/ui";
import { db } from "@/lib/db";
import { addTemplateItem, deleteTemplateItem, moveTemplateItem, updateDailyLogSettings } from "@/modules/daily-logs/actions";
import { ITEM_KINDS, KIND_LABELS } from "@/modules/daily-logs/logic";
import { getDailyLogsContext } from "@/modules/daily-logs/server";

export default async function DailyLogSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getDailyLogsContext(projectId);
  if (!ctx.canManage) notFound();
  const items = await db.dailyLogTemplateItem.findMany({ where: { projectId }, orderBy: { order: "asc" } });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Daily Logs settings</h2>
        <p className="text-sm text-ink-soft">Site coordinates for automatic weather, the mandatory work log and the log template&apos;s checklist.</p>
      </div>

      <section className={`${card} p-5`}>
        <h3 className="mb-3 font-semibold">Site and rules</h3>
        <ActionForm action={updateDailyLogSettings.bind(null, projectId)} resetOnSuccess={false} className="space-y-4" testId="log-settings-form">
          <div className="grid gap-3 sm:grid-cols-2 sm:max-w-lg">
            <div>
              <label className={label} htmlFor="latitude">Latitude</label>
              <input id="latitude" name="latitude" className={input} inputMode="decimal" placeholder="-24.39" defaultValue={ctx.project.latitude ?? ""} />
            </div>
            <div>
              <label className={label} htmlFor="longitude">Longitude</label>
              <input id="longitude" name="longitude" className={input} inputMode="decimal" placeholder="31.62" defaultValue={ctx.project.longitude ?? ""} />
            </div>
          </div>
          <p className="text-xs text-ink-soft">
            Decimal degrees (south and west are negative). New logs fetch the day&apos;s weather from Open-Meteo for this point; site teams can still edit it.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="workLogRequired" defaultChecked={ctx.settings.workLogRequired} className="mt-0.5 accent-brand" />
            <span>
              <span className="font-medium">Make the work log mandatory</span>
              <span className="block text-ink-soft">A log can&apos;t be published until the work carried out is described.</span>
            </span>
          </label>
          <SubmitButton>Save settings</SubmitButton>
        </ActionForm>
      </section>

      <section className={card}>
        <div className="border-b border-line px-5 py-3">
          <h3 className="font-semibold">Log template checklist</h3>
          <p className="text-sm text-ink-soft">Items added here appear on every new daily log (for example &quot;Toolbox talk held&quot;, &quot;Site gate locked at close&quot;). Existing logs keep the items they started with.</p>
        </div>
        <ol className="divide-y divide-line" data-testid="template-items">
          {items.map((i, n) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm" data-testid="template-item">
              <span>
                <span className="font-medium">{i.label}</span>
                {i.required && <span className="text-red-700" title="Required"> *</span>}
                <span className="ml-2 text-xs text-ink-soft">{KIND_LABELS[i.kind]}</span>
              </span>
              <span className="flex items-center gap-1">
                <form action={moveTemplateItem.bind(null, projectId, i.id, "up")}>
                  <button type="submit" className={btnGhost} disabled={n === 0} aria-label={`Move ${i.label} up`}>↑</button>
                </form>
                <form action={moveTemplateItem.bind(null, projectId, i.id, "down")}>
                  <button type="submit" className={btnGhost} disabled={n === items.length - 1} aria-label={`Move ${i.label} down`}>↓</button>
                </form>
                <form action={deleteTemplateItem.bind(null, projectId, i.id)}>
                  <ConfirmButton message={`Remove "${i.label}" from the template?`} className={btnDanger}>Remove</ConfirmButton>
                </form>
              </span>
            </li>
          ))}
          {!items.length && <li className="px-5 py-3 text-sm text-ink-soft">No custom items yet.</li>}
        </ol>
        <ActionForm action={addTemplateItem.bind(null, projectId)} className="border-t border-line p-5" testId="add-template-item-form">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label className={label} htmlFor="item-label">Item</label>
              <input id="item-label" name="label" className={input} maxLength={200} required />
            </div>
            <div>
              <label className={label} htmlFor="item-kind">Answer type</label>
              <select id="item-kind" name="kind" className={input} defaultValue="YES_NO">
                {ITEM_KINDS.map((k) => (
                  <option key={k} value={k}>{KIND_LABELS[k]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="required" className="accent-brand" /> Required before publishing
            </label>
            <SubmitButton>Add item</SubmitButton>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
