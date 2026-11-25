import { input, label } from "@/components/ui";
import { assigneeKey, dueDay, listOptions, statusLabel } from "@/modules/issues/logic";
import type { IssuesContext } from "@/modules/issues/server";

type Defaults = {
  title?: string;
  description?: string | null;
  typeId?: string | null;
  subtypeId?: string | null;
  statusId?: string | null;
  assigneeType?: string | null;
  assigneeId?: string | null;
  dueDate?: Date | null;
  locationId?: string | null;
  rootCauseId?: string | null;
  attributes?: unknown;
  watcherIds?: string[];
};

/** Assignee choices: people, roles and companies. */
export function AssigneeOptions({ ctx }: { ctx: IssuesContext }) {
  return (
    <>
      <optgroup label="People">
        {ctx.members.map((m) => <option key={m.userId} value={`USER:${m.userId}`}>{m.user.name}</option>)}
      </optgroup>
      {ctx.roles.length > 0 && (
        <optgroup label="Roles">
          {ctx.roles.map((r) => <option key={r.id} value={`ROLE:${r.id}`}>{r.name} (role)</option>)}
        </optgroup>
      )}
      {ctx.companies.length > 0 && (
        <optgroup label="Companies">
          {ctx.companies.map((c) => <option key={c.id} value={`COMPANY:${c.id}`}>{c.name} (company)</option>)}
        </optgroup>
      )}
    </>
  );
}

/** Every field of the create and edit forms. `withStatus` adds the status picker (create only). */
export function IssueFields({ ctx, defaults = {}, withStatus = false, idPrefix }: { ctx: IssuesContext; defaults?: Defaults; withStatus?: boolean; idPrefix: string }) {
  const id = (k: string) => `${idPrefix}-${k}`;
  const attrs = (defaults.attributes && typeof defaults.attributes === "object" ? defaults.attributes : {}) as Record<string, string>;
  const watchers = new Set(defaults.watcherIds ?? []);
  const keepType = (t: { id: string; active: boolean }) => t.active || t.id === defaults.typeId;
  const defaultStatus = ctx.statuses.find((s) => s.isDefault)?.id;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={label} htmlFor={id("title")}>Title</label>
        <input className={input} id={id("title")} name="title" required maxLength={200} defaultValue={defaults.title ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor={id("description")}>Description</label>
        <textarea className={input} id={id("description")} name="description" rows={3} maxLength={5000} defaultValue={defaults.description ?? ""} />
      </div>
      <div>
        <label className={label} htmlFor={id("type")}>Type</label>
        <select className={input} id={id("type")} name="typeId" defaultValue={defaults.typeId ?? ""}>
          <option value="">— None —</option>
          {ctx.types.filter(keepType).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div>
        <label className={label} htmlFor={id("subtype")}>Subtype</label>
        <select className={input} id={id("subtype")} name="subtypeId" defaultValue={defaults.subtypeId ?? ""}>
          <option value="">— None —</option>
          {ctx.types.filter(keepType).map((t) => (
            <optgroup key={t.id} label={t.name}>
              {t.subtypes.filter((s) => s.active || s.id === defaults.subtypeId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {withStatus && (
        <div>
          <label className={label} htmlFor={id("status")}>Status</label>
          <select className={input} id={id("status")} name="statusId" defaultValue={defaults.statusId ?? defaultStatus ?? ""}>
            {ctx.statuses.map((s) => <option key={s.id} value={s.id}>{statusLabel(s, ctx.statuses)}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className={label} htmlFor={id("assignee")}>Assigned to</label>
        <select className={input} id={id("assignee")} name="assignee" defaultValue={assigneeKey(defaults.assigneeType ?? null, defaults.assigneeId ?? null)}>
          <option value="">— Unassigned —</option>
          <AssigneeOptions ctx={ctx} />
        </select>
      </div>
      <div>
        <label className={label} htmlFor={id("due")}>Due date</label>
        <input className={input} type="date" id={id("due")} name="dueDate" defaultValue={defaults.dueDate ? dueDay(defaults.dueDate) : ""} />
      </div>
      <div>
        <label className={label} htmlFor={id("location")}>Location</label>
        <select className={input} id={id("location")} name="locationId" defaultValue={defaults.locationId ?? ""}>
          <option value="">— None —</option>
          {ctx.locationPaths.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
        </select>
      </div>
      <div>
        <label className={label} htmlFor={id("rootcause")}>Root cause</label>
        <select className={input} id={id("rootcause")} name="rootCauseId" defaultValue={defaults.rootCauseId ?? ""}>
          <option value="">— None —</option>
          {ctx.rootCauses.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      {ctx.attributes.map((a) => (
        <div key={a.id}>
          <label className={label} htmlFor={id(`attr-${a.id}`)}>{a.name}</label>
          {a.kind === "LIST" ? (
            <select className={input} id={id(`attr-${a.id}`)} name={`attr_${a.id}`} defaultValue={attrs[a.id] ?? ""}>
              <option value="">— None —</option>
              {listOptions(a.options).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              className={input}
              id={id(`attr-${a.id}`)}
              name={`attr_${a.id}`}
              type={a.kind === "DATE" ? "date" : "text"}
              inputMode={a.kind === "NUMBER" ? "decimal" : undefined}
              maxLength={500}
              defaultValue={attrs[a.id] ?? ""}
            />
          )}
        </div>
      ))}
      <fieldset className="sm:col-span-2">
        <legend className={label}>Watchers</legend>
        <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-2 overflow-y-auto">
          {ctx.members.map((m) => (
            <label key={m.userId} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="watcherIds" value={m.userId} defaultChecked={watchers.has(m.userId)} className="accent-brand" aria-label={`Watcher ${m.user.name}`} />
              {m.user.name}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
