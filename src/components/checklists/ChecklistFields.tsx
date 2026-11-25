import { input, label } from "@/components/ui";
import type { ChecklistsContext } from "@/modules/checklists/server";

type Defaults = { title?: string; assigneeType?: string | null; assigneeId?: string | null; locationId?: string | null; dueDate?: Date | null };

/** Title, assignee (person or company), location and due date: shared by the create and edit forms. */
export function ChecklistFields({ ctx, defaults = {}, idPrefix, titlePlaceholder }: { ctx: ChecklistsContext; defaults?: Defaults; idPrefix: string; titlePlaceholder?: string }) {
  const id = (k: string) => `${idPrefix}-${k}`;
  const assignee = defaults.assigneeType && defaults.assigneeId ? `${defaults.assigneeType}:${defaults.assigneeId}` : "";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={label} htmlFor={id("title")}>Title</label>
        <input className={input} id={id("title")} name="title" maxLength={200} defaultValue={defaults.title ?? ""} placeholder={titlePlaceholder} required={!titlePlaceholder} />
      </div>
      <div>
        <label className={label} htmlFor={id("assignee")}>Assigned to</label>
        <select className={input} id={id("assignee")} name="assignee" defaultValue={assignee}>
          <option value="">Unassigned</option>
          <optgroup label="People">
            {ctx.members.map((m) => <option key={m.userId} value={`USER:${m.userId}`}>{m.user.name}</option>)}
          </optgroup>
          {ctx.companies.length > 0 && (
            <optgroup label="Companies">
              {ctx.companies.map((c) => <option key={c.id} value={`COMPANY:${c.id}`}>{c.name} (company)</option>)}
            </optgroup>
          )}
        </select>
      </div>
      <div>
        <label className={label} htmlFor={id("location")}>Location</label>
        <select className={input} id={id("location")} name="locationId" defaultValue={defaults.locationId ?? ""}>
          <option value="">No location</option>
          {ctx.locationPaths.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
        </select>
        {ctx.locationPaths.length === 0 && <p className="mt-1 text-xs text-ink-soft">Locations are set up under Issues › Settings.</p>}
      </div>
      <div>
        <label className={label} htmlFor={id("due")}>Due date</label>
        <input className={input} type="date" id={id("due")} name="dueDate" defaultValue={defaults.dueDate ? defaults.dueDate.toISOString().slice(0, 10) : ""} />
      </div>
    </div>
  );
}
