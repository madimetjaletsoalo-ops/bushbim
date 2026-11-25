import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/docs/ConfirmButton";
import { PhotoUploader } from "@/components/issues/PhotoUploader";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, btn, btnDanger, btnGhost, card, input, label } from "@/components/ui";
import {
  addEquipment,
  addLabour,
  addVisitor,
  answerLogItem,
  deleteEquipment,
  deleteLabour,
  deleteLog,
  deleteVisitor,
  publishLog,
  refreshWeather,
  reopenLog,
  startLog,
  updateLabour,
  updateLogText,
  updateWeather,
} from "@/modules/daily-logs/actions";
import { deleteDailyLogPhoto } from "@/modules/daily-logs/media-actions";
import {
  KIND_LABELS,
  LIMITS,
  STATUS_COLORS,
  STATUS_LABELS,
  YES_NO,
  YES_NO_LABELS,
  canEditLabourRow,
  isFutureDay,
  itemAnswerText,
  labourTotals,
  parseDay,
  shiftDay,
  weatherSummary,
} from "@/modules/daily-logs/logic";
import { getDailyLogsContext, loadLogFull, type DailyLogFull, type DailyLogsContext } from "@/modules/daily-logs/server";

const YES_NO_STYLE: Record<string, string> = {
  YES: "border-emerald-600 bg-emerald-600 text-white",
  NO: "border-red-600 bg-red-600 text-white",
  NA: "border-gray-500 bg-gray-500 text-white",
};

export default async function DailyLogPage({ params }: { params: Promise<{ projectId: string; day: string }> }) {
  const { projectId, day: raw } = await params;
  const day = parseDay(raw);
  if (!day) notFound();
  const ctx = await getDailyLogsContext(projectId);
  const log = await loadLogFull(projectId, day);
  const base = `/projects/${projectId}/daily-logs`;
  const long = new Intl.DateTimeFormat("en-ZA", { dateStyle: "full", timeZone: "UTC" });
  const future = isFutureDay(day, ctx.project.timezone);
  const next = shiftDay(day, 1);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <Link href={base} className="text-ink-soft hover:underline">← Daily Logs</Link>
      <nav aria-label="Day" className="flex gap-2">
        <Link href={`${base}/${shiftDay(day, -1)}`} className={btnGhost}>← Previous day</Link>
        {!isFutureDay(next, ctx.project.timezone) && <Link href={`${base}/${next}`} className={btnGhost}>Next day →</Link>}
      </nav>
    </div>
  );

  if (!log) {
    return (
      <div className="space-y-4">
        {header}
        <div className={`${card} space-y-3 p-6`}>
          <h2 className="text-xl font-semibold">{long.format(new Date(`${day}T00:00:00Z`))}</h2>
          <p className="text-sm text-ink-soft" data-testid="no-log">
            {future ? "This day hasn't happened yet." : "There is no log for this day yet."}
          </p>
          {!future && ctx.canCreate && (
            <ActionForm action={startLog.bind(null, projectId)} testId="start-log-form">
              <input type="hidden" name="date" value={day} />
              <SubmitButton>Start log for this day</SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    );
  }

  const access = ctx.accessFor(log);
  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.project.timezone });
  const color = STATUS_COLORS[log.status];
  const totals = labourTotals(log.labour);
  const weather = weatherSummary(log);
  const noCoords = ctx.project.latitude === null || ctx.project.longitude === null;

  return (
    <div className="space-y-4">
      {header}
      <header className={`${card} space-y-3 border-l-4 p-5`} style={{ borderLeftColor: color }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink-soft">Daily log</p>
            <h2 className="text-xl font-semibold">{long.format(log.date)}</h2>
          </div>
          <span className={badge} style={{ background: `${color}22`, boxShadow: `inset 0 0 0 1px ${color}` }} data-testid="log-status">
            {STATUS_LABELS[log.status]}
          </span>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-ink-soft">Labour</dt><dd data-testid="labour-total">{totals.headcount} people · {totals.manHours} man-hours</dd></div>
          <div><dt className="text-xs text-ink-soft">Weather</dt><dd>{weather || "—"}</dd></div>
          <div><dt className="text-xs text-ink-soft">Started</dt><dd>{fmt.format(log.createdAt)} by {log.createdBy?.name ?? "former member"}</dd></div>
        </dl>
        {log.status === "PUBLISHED" && log.publishedAt && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="published-note">
            Published by {log.publishedBy?.name ?? "former member"} on {fmt.format(log.publishedAt)}. The log is locked.
            {access.reopenNeedsManager && " It was published more than 24 hours ago, so only a Daily Logs Manager can reopen it."}
          </p>
        )}
        {ctx.settings.workLogRequired && log.status === "DRAFT" && (
          <p className="text-sm text-ink-soft" data-testid="work-log-required">The work log is mandatory on this project before publishing.</p>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <a href={`/api/projects/${projectId}/daily-logs/${day}/pdf`} className={btnGhost} data-testid="log-pdf">Download PDF</a>
          {access.publish && (
            <ActionForm action={publishLog.bind(null, projectId, log.id)} testId="publish-form">
              <SubmitButton>Publish log</SubmitButton>
            </ActionForm>
          )}
          {access.reopen && (
            <ActionForm action={reopenLog.bind(null, projectId, log.id)} testId="reopen-form">
              <SubmitButton className={btnGhost}>Reopen</SubmitButton>
            </ActionForm>
          )}
          {access.delete && (
            <form action={deleteLog.bind(null, projectId, log.id)} className="ml-auto">
              <ConfirmButton message="Delete this daily log with its rows and photos?" className={`${btnGhost} text-red-700`}>Delete</ConfirmButton>
            </form>
          )}
        </div>
      </header>

      {/* Weather */}
      <section className={card} data-testid="weather-section">
        <h3 className="border-b border-line px-4 py-3 font-semibold">Weather</h3>
        <div className="space-y-3 p-4">
          <p className="text-sm" data-testid="weather-summary">
            {weather || <span className="text-ink-soft">Not recorded.</span>}
            {log.weatherSource && (
              <span className="ml-2 text-xs text-ink-soft" data-testid="weather-source">
                {log.weatherSource === "AUTO" ? "From Open-Meteo for the project's coordinates" : "Entered on site"}
              </span>
            )}
          </p>
          {log.weatherNote && <p className="text-sm">Note: {log.weatherNote}</p>}
          {access.edit && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <ActionForm action={refreshWeather.bind(null, projectId, log.id)} resetOnSuccess={false} testId="refresh-weather-form">
                  <SubmitButton className={btnGhost}>Fetch from Open-Meteo</SubmitButton>
                </ActionForm>
                {noCoords && (
                  <p className="text-xs text-ink-soft">
                    Automatic weather needs the project&apos;s coordinates
                    {ctx.canManage ? (
                      <>
                        {" "}(<Link href={`${base}/settings`} className="text-brand hover:underline">set them in Settings</Link>).
                      </>
                    ) : (
                      ", set by a Daily Logs Manager."
                    )}
                  </p>
                )}
              </div>
              <details className="rounded-md border border-line">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">Edit weather</summary>
                <ActionForm action={updateWeather.bind(null, projectId, log.id)} resetOnSuccess={false} className="space-y-3 border-t border-line p-3" testId="weather-form">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <Field id="w-cond" label="Conditions" name="conditions" defaultValue={log.conditions ?? ""} className="lg:col-span-1" />
                    <Field id="w-min" label="Min °C" name="tempMin" defaultValue={log.tempMin ?? ""} inputMode="decimal" />
                    <Field id="w-max" label="Max °C" name="tempMax" defaultValue={log.tempMax ?? ""} inputMode="decimal" />
                    <Field id="w-rain" label="Rain (mm)" name="precipitation" defaultValue={log.precipitation ?? ""} inputMode="decimal" />
                    <Field id="w-wind" label="Wind (km/h)" name="windMax" defaultValue={log.windMax ?? ""} inputMode="decimal" />
                  </div>
                  <Field id="w-note" label="Weather note (e.g. rain stopped work 13:00–15:00)" name="weatherNote" defaultValue={log.weatherNote ?? ""} />
                  <SubmitButton>Save weather</SubmitButton>
                </ActionForm>
              </details>
            </>
          )}
        </div>
      </section>

      <LabourSection ctx={ctx} log={log} projectId={projectId} access={access} />

      {/* Work log and notes */}
      <section className={card} data-testid="work-section">
        <h3 className="border-b border-line px-4 py-3 font-semibold">
          Work log{ctx.settings.workLogRequired && <span className="ml-2 text-xs font-normal text-red-700">Required</span>}
        </h3>
        <div className="p-4">
          {access.edit ? (
            <ActionForm action={updateLogText.bind(null, projectId, log.id)} resetOnSuccess={false} className="space-y-3" testId="work-form">
              <div>
                <label className={label} htmlFor="workSummary">Work carried out</label>
                <textarea id="workSummary" name="workSummary" rows={4} maxLength={LIMITS.text} className={input} defaultValue={log.workSummary ?? ""} />
              </div>
              <div>
                <label className={label} htmlFor="notes">Notes (delays, deliveries, safety, instructions)</label>
                <textarea id="notes" name="notes" rows={3} maxLength={LIMITS.text} className={input} defaultValue={log.notes ?? ""} />
              </div>
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
          ) : (
            <div className="space-y-3 text-sm">
              <div><p className="text-xs text-ink-soft">Work carried out</p><p className="whitespace-pre-wrap" data-testid="work-summary">{log.workSummary ?? "—"}</p></div>
              <div><p className="text-xs text-ink-soft">Notes</p><p className="whitespace-pre-wrap">{log.notes ?? "—"}</p></div>
            </div>
          )}
        </div>
      </section>

      {/* Equipment */}
      <section className={card} data-testid="equipment-section">
        <h3 className="border-b border-line px-4 py-3 font-semibold">Equipment</h3>
        <ul className="divide-y divide-line">
          {log.equipment.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm" data-testid="equipment-row">
              <span>
                <span className="font-medium">{e.name}</span> × {e.quantity}
                {e.hours !== null && <span className="text-ink-soft"> · {e.hours} h</span>}
                {e.notes && <span className="block text-xs text-ink-soft">{e.notes}</span>}
              </span>
              {access.edit && (
                <form action={deleteEquipment.bind(null, projectId, log.id, e.id)}>
                  <ConfirmButton message={`Remove ${e.name}?`} className={btnDanger}>Remove</ConfirmButton>
                </form>
              )}
            </li>
          ))}
          {!log.equipment.length && <li className="px-4 py-3 text-sm text-ink-soft">No equipment recorded.</li>}
        </ul>
        {access.edit && (
          <ActionForm action={addEquipment.bind(null, projectId, log.id)} className="border-t border-line p-4" testId="add-equipment-form">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field id="eq-name" label="Equipment" name="name" required className="sm:col-span-2" placeholder="e.g. TLB, concrete mixer" />
              <Field id="eq-qty" label="Quantity" name="quantity" defaultValue="1" inputMode="numeric" />
              <Field id="eq-hours" label="Hours used" name="hours" inputMode="decimal" />
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field id="eq-notes" label="Notes" name="notes" className="min-w-0 flex-1" />
              <SubmitButton className={btnGhost}>Add equipment</SubmitButton>
            </div>
          </ActionForm>
        )}
      </section>

      {/* Visitors */}
      <section className={card} data-testid="visitors-section">
        <h3 className="border-b border-line px-4 py-3 font-semibold">Visitors</h3>
        <ul className="divide-y divide-line">
          {log.visitors.map((v) => (
            <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm" data-testid="visitor-row">
              <span>
                <span className="font-medium">{v.name}</span>
                {v.organisation && <span className="text-ink-soft"> · {v.organisation}</span>}
                {(v.arrivedAt || v.leftAt) && <span className="text-ink-soft"> · {v.arrivedAt ?? "?"}–{v.leftAt ?? "?"}</span>}
                {v.purpose && <span className="block text-xs text-ink-soft">{v.purpose}</span>}
              </span>
              {access.edit && (
                <form action={deleteVisitor.bind(null, projectId, log.id, v.id)}>
                  <ConfirmButton message={`Remove ${v.name}?`} className={btnDanger}>Remove</ConfirmButton>
                </form>
              )}
            </li>
          ))}
          {!log.visitors.length && <li className="px-4 py-3 text-sm text-ink-soft">No visitors recorded.</li>}
        </ul>
        {access.edit && (
          <ActionForm action={addVisitor.bind(null, projectId, log.id)} className="border-t border-line p-4" testId="add-visitor-form">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field id="v-name" label="Visitor name" name="name" required />
              <Field id="v-org" label="Organisation" name="organisation" />
              <Field id="v-in" label="Arrived" name="arrivedAt" type="time" />
              <Field id="v-out" label="Left" name="leftAt" type="time" />
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field id="v-purpose" label="Purpose" name="purpose" className="min-w-0 flex-1" />
              <SubmitButton className={btnGhost}>Add visitor</SubmitButton>
            </div>
          </ActionForm>
        )}
      </section>

      {/* Custom checklist items */}
      {log.items.length > 0 && (
        <section className={card} data-testid="log-checklist">
          <h3 className="border-b border-line px-4 py-3 font-semibold">Checklist</h3>
          <ol className="divide-y divide-line">
            {log.items.map((i) => (
              <li key={i.id} className="space-y-2 px-4 py-3" data-testid="log-item">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    {i.label}
                    {i.required && <span className="text-red-700" title="Required"> *</span>}
                  </p>
                  <p className="text-xs text-ink-soft">{KIND_LABELS[i.kind]}</p>
                </div>
                {access.edit ? (
                  i.kind === "YES_NO" ? (
                    <ActionForm action={answerLogItem.bind(null, projectId, log.id, i.id)} resetOnSuccess={false}>
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
                    <ActionForm action={answerLogItem.bind(null, projectId, log.id, i.id)} resetOnSuccess={false} className="flex max-w-xl flex-wrap items-start gap-2">
                      <input name="value" className={`${input} min-w-0 flex-1`} inputMode={i.kind === "NUMBER" ? "decimal" : undefined} defaultValue={i.value ?? ""} aria-label={`Answer: ${i.label}`} />
                      <SubmitButton className={btnGhost}>Save</SubmitButton>
                    </ActionForm>
                  )
                ) : (
                  <p className={`text-sm ${i.value ? "font-medium" : "text-ink-soft"}`}>{itemAnswerText(i) || "Not answered"}</p>
                )}
                {i.answeredAt && <p className="text-xs text-ink-soft">{i.answeredBy?.name ?? "Former member"} · {fmt.format(i.answeredAt)}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Photos */}
      <section className={card} data-testid="log-photos">
        <h3 className="border-b border-line px-4 py-3 font-semibold">Photos</h3>
        <div className="space-y-3 p-4">
          {log.photos.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="photo-grid">
              {log.photos.map((ph) => (
                <li key={ph.id} className="min-w-0 text-xs" data-testid="photo">
                  <a href={`/api/projects/${projectId}/photos/${ph.id}`} target="_blank" rel="noopener" className="block aspect-[4/3] overflow-hidden rounded border border-line bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/projects/${projectId}/photos/${ph.id}?size=thumb`} alt={ph.caption ?? ph.fileName} loading="lazy" className="h-full w-full object-cover" />
                  </a>
                  {ph.caption && <p className="mt-0.5 truncate text-sm">{ph.caption}</p>}
                  <p className="truncate text-ink-soft">{ph.uploadedBy?.name ?? "Former member"} · {fmt.format(ph.createdAt)}</p>
                  {access.contribute && (ctx.canCreate || ph.uploadedById === ctx.user.id) && (
                    <form action={deleteDailyLogPhoto.bind(null, projectId, log.id, ph.id)}>
                      <ConfirmButton message="Remove this photo?" className="font-medium text-red-700 hover:underline">Remove</ConfirmButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No photos yet.</p>
          )}
          {access.contribute && <PhotoUploader projectId={projectId} issueId={null} dailyLogId={log.id} label="Add photos" />}
        </div>
      </section>
    </div>
  );
}

function Field({
  id,
  label: text,
  className,
  ...rest
}: { id: string; label: string; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "className">) {
  return (
    <div className={className}>
      <label className={label} htmlFor={id}>{text}</label>
      <input id={id} className={input} {...rest} />
    </div>
  );
}

function LabourSection({ ctx, log, projectId, access }: { ctx: DailyLogsContext; log: DailyLogFull; projectId: string; access: ReturnType<DailyLogsContext["accessFor"]> }) {
  const totals = labourTotals(log.labour);
  const contributorOnly = access.contribute && !ctx.canCreate;
  return (
    <section className={card} data-testid="labour-section">
      <h3 className="border-b border-line px-4 py-3 font-semibold">Labour and work</h3>
      <ul className="divide-y divide-line">
        {log.labour.map((l) => {
          const editable = canEditLabourRow(access, ctx.level, ctx.member, l);
          return (
            <li key={l.id} className="space-y-1 px-4 py-3 text-sm" data-testid="labour-row">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p>
                  <span className="font-medium">{l.companyName}</span>
                  {l.trade && <span className="text-ink-soft"> · {l.trade}</span>}
                </p>
                <p className="whitespace-nowrap" data-testid="labour-figures">{l.headcount} people × {l.hours} h</p>
              </div>
              {l.work && <p className="whitespace-pre-wrap text-ink">{l.work}</p>}
              <p className="text-xs text-ink-soft">Entered by {l.createdBy?.name ?? "former member"}</p>
              {editable && (
                <details className="rounded-md border border-line">
                  <summary className="cursor-pointer select-none px-3 py-1.5 text-sm font-medium">Edit</summary>
                  <ActionForm action={updateLabour.bind(null, projectId, log.id, l.id)} resetOnSuccess={false} className="space-y-3 border-t border-line p-3">
                    <LabourFields ctx={ctx} idPrefix={`edit-${l.id}`} contributorOnly={contributorOnly} defaults={l} />
                    <div className="flex items-center gap-3">
                      <SubmitButton className={btnGhost}>Save</SubmitButton>
                    </div>
                  </ActionForm>
                  <form action={deleteLabour.bind(null, projectId, log.id, l.id)} className="px-3 pb-3">
                    <ConfirmButton message={`Remove ${l.companyName}'s row?`} className={btnDanger}>Remove row</ConfirmButton>
                  </form>
                </details>
              )}
            </li>
          );
        })}
        {!log.labour.length && <li className="px-4 py-3 text-sm text-ink-soft">No labour recorded yet.</li>}
        {log.labour.length > 0 && (
          <li className="flex justify-between px-4 py-2 text-sm font-semibold">
            <span>Total</span>
            <span>{totals.headcount} people · {totals.manHours} man-hours</span>
          </li>
        )}
      </ul>
      {access.contribute && (
        <ActionForm action={addLabour.bind(null, projectId, log.id)} className="space-y-3 border-t border-line p-4" testId="add-labour-form">
          {contributorOnly && <p className="text-sm text-ink-soft">Add your company&apos;s labour and the work it carried out today.</p>}
          <LabourFields ctx={ctx} idPrefix="add" contributorOnly={contributorOnly} />
          <SubmitButton className={btn}>Add labour</SubmitButton>
        </ActionForm>
      )}
    </section>
  );
}

function LabourFields({
  ctx,
  idPrefix,
  contributorOnly,
  defaults,
}: {
  ctx: DailyLogsContext;
  idPrefix: string;
  contributorOnly: boolean;
  defaults?: { companyId: string | null; companyName: string; trade: string | null; headcount: number; hours: number; work: string | null };
}) {
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {contributorOnly ? (
          <div>
            <p className={label}>Company</p>
            <p className="py-2 text-sm font-medium" data-testid="own-company">{ctx.ownCompany?.name ?? "Your company"}</p>
          </div>
        ) : (
          <div>
            <label className={label} htmlFor={id("company")}>Company</label>
            <select id={id("company")} name="companyId" className={input} defaultValue={defaults ? (defaults.companyId ?? "") : (ctx.ownCompany?.id ?? "")}>
              <option value="">Other crew (type a name)</option>
              {ctx.companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        {!contributorOnly && (
          <Field id={id("crew")} label="Crew name" placeholder="For Other crew" name="crew" defaultValue={defaults && !defaults.companyId ? defaults.companyName : ""} maxLength={LIMITS.short} />
        )}
        <Field id={id("trade")} label="Trade" name="trade" defaultValue={defaults?.trade ?? ""} maxLength={LIMITS.short} />
        <Field id={id("headcount")} label="Headcount" name="headcount" inputMode="numeric" required defaultValue={defaults?.headcount ?? ""} />
        <Field id={id("hours")} label="Hours each" name="hours" inputMode="decimal" required defaultValue={defaults?.hours ?? "8"} />
      </div>
      <div>
        <label className={label} htmlFor={id("work")}>Work carried out</label>
        <textarea id={id("work")} name="work" rows={2} maxLength={LIMITS.text} className={input} defaultValue={defaults?.work ?? ""} />
      </div>
    </>
  );
}
