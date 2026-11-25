import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmButton } from "@/components/docs/ConfirmButton";
import { badge, btnDanger, btnGhost, card, input, label } from "@/components/ui";
import { db } from "@/lib/db";
import {
  addAttribute,
  addLocation,
  addRootCause,
  addType,
  deleteAttribute,
  deleteLocation,
  deleteRootCause,
  deleteStatus,
  moveStatus,
  renameType,
  saveStatus,
  setDefaultStatus,
  setTypeActive,
} from "@/modules/issues/actions";
import { listOptions } from "@/modules/issues/logic";
import { getIssuesContext } from "@/modules/issues/server";

const small = "rounded px-2 py-1 text-xs font-medium text-ink-soft hover:bg-muted hover:text-ink disabled:opacity-40";

export default async function IssueSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getIssuesContext(projectId);
  if (!ctx.canManage) notFound();
  const usage = new Map(
    (await db.issue.groupBy({ by: ["statusId"], where: { projectId }, _count: { _all: true } })).map((g) => [g.statusId, g._count._all]),
  );
  const tops = ctx.statuses.filter((s) => s.depth === 0);
  // binds a settings action to this project and its arguments, for a plain <form action>
  const bind = <A extends unknown[]>(fn: (projectId: string, ...a: A) => Promise<void>, ...a: A) => (fn as (...x: unknown[]) => Promise<void>).bind(null, projectId, ...a) as () => Promise<void>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Issues settings</h2>
        <p className="mt-1 text-sm text-ink-soft">Statuses, types, root causes, custom attributes and locations for this project.</p>
      </div>

      {/* ⭐ custom statuses */}
      <section className={`${card} p-5`} data-testid="status-settings">
        <h3 className="font-semibold">Statuses</h3>
        <p className="mb-4 mt-1 text-sm text-ink-soft">
          Rename, recolour, reorder or add statuses, and nest sub-statuses under a status. Closed statuses stop the overdue clock; draft issues are
          visible only to their creator and Managers.
        </p>
        <ul className="divide-y divide-line" data-testid="status-list">
          {ctx.statuses.map((s) => {
            const siblings = ctx.statuses.filter((x) => x.parentId === s.parentId);
            const i = siblings.findIndex((x) => x.id === s.id);
            const used = usage.get(s.id) ?? 0;
            const hasChildren = ctx.statuses.some((x) => x.parentId === s.id);
            return (
              <li key={s.id} className={`flex flex-wrap items-center gap-2 py-2 ${s.depth ? "pl-6" : ""}`} data-testid="status-row">
                <ActionForm action={saveStatus.bind(null, projectId)} resetOnSuccess={false} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={s.id} />
                  <input type="color" name="color" defaultValue={s.color} aria-label={`Colour of ${s.name}`} className="h-8 w-9 cursor-pointer rounded border border-line bg-surface" />
                  <input className={`${input} w-44 py-1`} name="name" defaultValue={s.name} aria-label={`Name of ${s.name}`} maxLength={60} required />
                  <label className="inline-flex items-center gap-1 text-xs">
                    <input type="checkbox" name="closed" defaultChecked={s.closed} className="accent-brand" /> Closed
                  </label>
                  <label className="inline-flex items-center gap-1 text-xs">
                    <input type="checkbox" name="draft" defaultChecked={s.draft} className="accent-brand" /> Draft
                  </label>
                  <SubmitButton className={btnGhost + " py-1"}>Save</SubmitButton>
                </ActionForm>
                <div className="flex items-center gap-1">
                  {s.isDefault ? (
                    <span className={`${badge} bg-brand/10 text-brand`}>Default for new issues</span>
                  ) : (
                    !s.closed && !s.draft && (
                      <form action={bind(setDefaultStatus, s.id)}>
                        <button className={small} type="submit">Make default</button>
                      </form>
                    )
                  )}
                  <form action={bind(moveStatus, s.id, "up" as const)}>
                    <button className={small} type="submit" disabled={i === 0} aria-label={`Move ${s.name} up`}>↑</button>
                  </form>
                  <form action={bind(moveStatus, s.id, "down" as const)}>
                    <button className={small} type="submit" disabled={i === siblings.length - 1} aria-label={`Move ${s.name} down`}>↓</button>
                  </form>
                  <span className="w-16 text-right text-xs text-ink-soft">{used} {used === 1 ? "issue" : "issues"}</span>
                  {!used && !hasChildren && !s.isDefault && (
                    <form action={bind(deleteStatus, s.id)}>
                      <ConfirmButton className={btnDanger} message={`Delete the status "${s.name}"?`}>Delete</ConfirmButton>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <ActionForm action={saveStatus.bind(null, projectId)} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end" testId="add-status-form">
          <div>
            <label className={label} htmlFor="ns-color">Colour</label>
            <input type="color" id="ns-color" name="color" defaultValue="#0d9488" className="h-9 w-12 cursor-pointer rounded border border-line bg-surface" />
          </div>
          <div>
            <label className={label} htmlFor="ns-name">New status</label>
            <input className={input} id="ns-name" name="name" maxLength={60} required placeholder="e.g. Awaiting subcontractor" />
          </div>
          <div>
            <label className={label} htmlFor="ns-parent">Sub-status of</label>
            <select className={input} id="ns-parent" name="parentId" defaultValue="">
              <option value="">— Top level —</option>
              {tops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1 text-sm">
              <input type="checkbox" name="closed" className="accent-brand" /> Closed
            </label>
            <SubmitButton>Add status</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section className={`${card} p-5`} data-testid="type-settings">
        <h3 className="font-semibold">Types and subtypes</h3>
        <p className="mb-4 mt-1 text-sm text-ink-soft">Deactivated types stay on existing issues but can&apos;t be picked for new ones.</p>
        <ul className="space-y-3">
          {ctx.types.map((t) => (
            <li key={t.id} className="rounded-md border border-line p-3" data-testid="type-row">
              <div className="flex flex-wrap items-center gap-2">
                <ActionForm action={renameType.bind(null, projectId)} resetOnSuccess={false} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={t.id} />
                  <input className={`${input} w-48 py-1 font-medium`} name="name" defaultValue={t.name} aria-label={`Name of type ${t.name}`} maxLength={60} required />
                  <SubmitButton className={btnGhost + " py-1"}>Rename</SubmitButton>
                </ActionForm>
                {!t.active && <span className={`${badge} bg-muted text-ink-soft`}>Inactive</span>}
                <form action={bind(setTypeActive, t.id, !t.active)}>
                  <button className={small} type="submit">{t.active ? "Deactivate" : "Activate"}</button>
                </form>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2 pl-1">
                {t.subtypes.map((s) => (
                  <li key={s.id} className={`${badge} gap-1 ${s.active ? "bg-muted text-ink" : "bg-muted text-ink-soft line-through"}`}>
                    {s.name}
                    <form action={bind(setTypeActive, s.id, !s.active)} className="inline">
                      <button className="text-ink-soft hover:text-ink" type="submit" aria-label={`${s.active ? "Deactivate" : "Activate"} ${s.name}`}>{s.active ? "×" : "↺"}</button>
                    </form>
                  </li>
                ))}
              </ul>
              <ActionForm action={addType.bind(null, projectId)} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="typeId" value={t.id} />
                <input className={`${input} w-48 py-1`} name="name" maxLength={60} required aria-label={`New subtype of ${t.name}`} placeholder="Add subtype" />
                <SubmitButton className={btnGhost + " py-1"}>Add</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
        <ActionForm action={addType.bind(null, projectId)} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4" testId="add-type-form">
          <div>
            <label className={label} htmlFor="nt-name">New type</label>
            <input className={input} id="nt-name" name="name" maxLength={60} required placeholder="e.g. Environmental" />
          </div>
          <SubmitButton>Add type</SubmitButton>
        </ActionForm>
      </section>

      <section className={`${card} p-5`}>
        <h3 className="mb-3 font-semibold">Root causes</h3>
        <ul className="flex flex-wrap gap-2" data-testid="root-causes">
          {ctx.rootCauses.map((r) => (
            <li key={r.id} className={`${badge} gap-1 bg-muted text-ink`}>
              {r.name}
              <form action={bind(deleteRootCause, r.id)} className="inline">
                <ConfirmButton className="text-ink-soft hover:text-ink" message={`Remove the root cause "${r.name}"? Issues that use it will have none.`}>×</ConfirmButton>
              </form>
            </li>
          ))}
        </ul>
        <ActionForm action={addRootCause.bind(null, projectId)} className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className={label} htmlFor="nr-name">New root cause</label>
            <input className={input} id="nr-name" name="name" maxLength={60} required />
          </div>
          <SubmitButton>Add root cause</SubmitButton>
        </ActionForm>
      </section>

      <section className={`${card} p-5`} data-testid="attribute-settings">
        <h3 className="font-semibold">Custom attributes</h3>
        <p className="mb-3 mt-1 text-sm text-ink-soft">Extra fields on every issue, also available in the filter panel and CSV export.</p>
        {ctx.attributes.length === 0 ? (
          <p className="text-sm text-ink-soft">None yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {ctx.attributes.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-medium">{a.name}</span> <span className="text-ink-soft">· {a.kind.toLowerCase()}</span>
                  {a.kind === "LIST" && <span className="block text-xs text-ink-soft">{listOptions(a.options).join(", ")}</span>}
                </span>
                <form action={bind(deleteAttribute, a.id)}>
                  <ConfirmButton className={btnDanger} message={`Delete the attribute "${a.name}"? Its values will no longer show.`}>Delete</ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addAttribute.bind(null, projectId)} className="mt-3 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_10rem_1fr_auto] sm:items-end" testId="add-attribute-form">
          <div>
            <label className={label} htmlFor="na-name">Attribute name</label>
            <input className={input} id="na-name" name="name" maxLength={60} required placeholder="e.g. Trade" />
          </div>
          <div>
            <label className={label} htmlFor="na-kind">Kind</label>
            <select className={input} id="na-kind" name="kind" defaultValue="LIST">
              <option value="LIST">List</option>
              <option value="TEXT">Text</option>
              <option value="NUMBER">Number</option>
              <option value="DATE">Date</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="na-options">List options</label>
            <input className={input} id="na-options" name="options" placeholder="Comma-separated, for lists" />
          </div>
          <SubmitButton>Add attribute</SubmitButton>
        </ActionForm>
      </section>

      <section className={`${card} p-5`} data-testid="location-settings">
        <h3 className="font-semibold">Locations</h3>
        <p className="mb-3 mt-1 text-sm text-ink-soft">The places issues are raised in, e.g. Site › Zone › Villa › Room.</p>
        {ctx.locationPaths.length === 0 ? (
          <p className="text-sm text-ink-soft">None yet.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="location-list">
            {ctx.locationPaths.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-1.5 text-sm" style={{ paddingLeft: `${l.depth * 1.25}rem` }}>
                <span className="break-words">{ctx.locations.find((x) => x.id === l.id)?.name}</span>
                <form action={bind(deleteLocation, l.id)}>
                  <ConfirmButton className={btnDanger} message="Delete this location and everything inside it? Issues there will have no location.">Delete</ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addLocation.bind(null, projectId)} className="mt-3 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" testId="add-location-form">
          <div>
            <label className={label} htmlFor="nl-name">Location name</label>
            <input className={input} id="nl-name" name="name" maxLength={60} required placeholder="e.g. Villa 3" />
          </div>
          <div>
            <label className={label} htmlFor="nl-parent">Inside</label>
            <select className={input} id="nl-parent" name="parentId" defaultValue="">
              <option value="">— Top level —</option>
              {ctx.locationPaths.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
            </select>
          </div>
          <SubmitButton>Add location</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
