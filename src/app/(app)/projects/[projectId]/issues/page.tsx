import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AssigneeOptions } from "@/components/issues/IssueFields";
import { badge, btn, btnGhost, card, input, label, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { activeFilterCount, buildIssueWhere, dueDay, filterQuery, isOverdue, issueLabel, listOptions, parseFilters, statusLabel } from "@/modules/issues/logic";
import { getIssuesContext } from "@/modules/issues/server";

const PAGE = 500;

export default async function IssuesPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId } = await params;
  const ctx = await getIssuesContext(projectId);
  const f = parseFilters(await searchParams);
  const where = buildIssueWhere(projectId, f, {
    statuses: ctx.statuses,
    attributes: ctx.attributes,
    timeZone: ctx.project.timezone,
    userId: ctx.user.id,
    manager: ctx.canManage,
  }) as Prisma.IssueWhereInput;
  const [issues, total] = await Promise.all([
    db.issue.findMany({
      where,
      include: { status: true, type: true, subtype: true },
      orderBy: { number: "desc" },
      take: PAGE,
    }),
    db.issue.count({ where }),
  ]);
  const base = `/projects/${projectId}/issues`;
  const query = filterQuery(f);
  const filters = activeFilterCount(f);
  const locPath = new Map(ctx.locationPaths.map((l) => [l.id, l.path]));
  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "UTC" });
  const checked = (list: string[], id: string) => list.includes(id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Issues</h2>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/projects/${projectId}/issues/export${query ? `?${query}` : ""}`} className={btnGhost} data-testid="export-csv">Export CSV</a>
          {ctx.canCreate && <Link href={`${base}/new`} className={btn}>New issue</Link>}
        </div>
      </div>

      {/* keyed by the query so client navigation (e.g. Clear) resets the uncontrolled inputs */}
      <form key={`q-${query}`} className="flex w-full gap-2 sm:max-w-md" role="search" action={base}>
        <input className={input} type="search" name="q" defaultValue={f.q} aria-label="Search issues" placeholder="Search title, description or #ID" />
        <button className={btnGhost} type="submit">Search</button>
      </form>

      <details key={`f-${query}`} className={`${card} group`} open={filters > (f.q ? 1 : 0)} data-testid="filter-panel">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold">
          Filters{filters > 0 && <span className={`${badge} ml-2 bg-brand/10 text-brand`}>{filters} active</span>}
        </summary>
        <form action={base} className="grid gap-4 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-3">
          {f.q && <input type="hidden" name="q" value={f.q} />}
          <fieldset>
            <legend className={label}>Type</legend>
            <div className="flex flex-col gap-1">
              {ctx.types.map((t) => (
                <label key={t.id} className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" name="type" value={t.id} defaultChecked={checked(f.typeIds, t.id)} className="accent-brand" aria-label={`Type ${t.name}`} />
                  {t.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className={label}>Status</legend>
            <div className="flex flex-col gap-1">
              {ctx.statuses.map((s) => (
                <label key={s.id} className={`inline-flex items-center gap-2 text-sm ${s.depth ? "pl-5" : ""}`}>
                  <input type="checkbox" name="status" value={s.id} defaultChecked={checked(f.statusIds, s.id)} className="accent-brand" aria-label={`Status ${statusLabel(s, ctx.statuses)}`} />
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-3">
            <div>
              <label className={label} htmlFor="f-createdby">Created by</label>
              <select className={input} id="f-createdby" name="createdBy" defaultValue={f.createdById}>
                <option value="">Anyone</option>
                {ctx.members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="f-assignee">Assigned to</label>
              <select className={input} id="f-assignee" name="assignee" defaultValue={f.assignee}>
                <option value="">Anyone</option>
                <AssigneeOptions ctx={ctx} />
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label} htmlFor="f-from">Created from</label>
                <input className={input} type="date" id="f-from" name="from" defaultValue={f.createdFrom} />
              </div>
              <div>
                <label className={label} htmlFor="f-to">Created to</label>
                <input className={input} type="date" id="f-to" name="to" defaultValue={f.createdTo} />
              </div>
            </div>
          </div>
          {ctx.attributes.map((a) => (
            <div key={a.id}>
              <label className={label} htmlFor={`f-a-${a.id}`}>{a.name}</label>
              {a.kind === "LIST" ? (
                <select className={input} id={`f-a-${a.id}`} name={`a_${a.id}`} defaultValue={f.attrs[a.id] ?? ""}>
                  <option value="">Any</option>
                  {listOptions(a.options).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input className={input} id={`f-a-${a.id}`} name={`a_${a.id}`} type={a.kind === "DATE" ? "date" : "text"} defaultValue={f.attrs[a.id] ?? ""} placeholder={a.kind === "TEXT" ? "Contains…" : "Equals…"} />
              )}
            </div>
          ))}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
            <button type="submit" className={btn}>Apply filters</button>
            <Link href={base} className={btnGhost}>Clear</Link>
          </div>
        </form>
      </details>

      <p className="text-sm text-ink-soft" data-testid="issue-count">
        {total === 1 ? "1 issue" : `${total} issues`}
        {total > PAGE && ` (showing the newest ${PAGE}; narrow the filters to see others)`}
      </p>

      {issues.length === 0 ? (
        <div className={`${card} p-8 text-center text-sm text-ink-soft`}>
          {filters ? "No issues match these filters." : "No issues yet. Record defects, snags and safety observations here."}
        </div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full" data-testid="issues-table">
            <thead className="border-b border-line bg-muted/50">
              <tr>
                <th className="w-1.5 p-0"><span className="sr-only">Status colour</span></th>
                <th className={`${th} w-16`}>ID</th>
                <th className={th}>Type &amp; title</th>
                <th className={th}>Status</th>
                <th className={`${th} hidden md:table-cell`}>Assigned to</th>
                <th className={`${th} hidden sm:table-cell`}>Due</th>
                <th className={`${th} hidden lg:table-cell`}>Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {issues.map((i) => {
                const overdue = isOverdue(i.dueDate, i.status.closed, ctx.project.timezone);
                const assignee = ctx.assigneeName(i.assigneeType, i.assigneeId);
                return (
                  <tr key={i.id} data-testid="issue-row">
                    <td className="w-1.5 p-0" style={{ background: i.status.color }} data-testid="status-bar" aria-hidden />
                    <td className={`${td} whitespace-nowrap text-ink-soft`}>{issueLabel(i.number)}</td>
                    <td className={td}>
                      {i.type && (
                        <p className="text-xs text-ink-soft">
                          {i.type.name}
                          {i.subtype && ` › ${i.subtype.name}`}
                        </p>
                      )}
                      <Link href={`${base}/${i.id}`} className="font-medium break-words hover:underline">{i.title}</Link>
                      <p className="mt-1 text-xs text-ink-soft sm:hidden">
                        {i.dueDate && <span className={overdue ? "text-red-700" : ""}>Due {fmt.format(i.dueDate)}</span>}
                        {assignee && <span>{i.dueDate ? " · " : ""}{assignee}</span>}
                      </p>
                    </td>
                    <td className={td}>
                      <span className={`${badge} whitespace-nowrap`} style={{ background: `${i.status.color}22`, color: "inherit", boxShadow: `inset 0 0 0 1px ${i.status.color}` }} data-testid="issue-status">
                        {statusLabel(i.status, ctx.statuses)}
                      </span>
                    </td>
                    <td className={`${td} hidden md:table-cell`}>{assignee ?? <span className="text-ink-soft">Unassigned</span>}</td>
                    <td className={`${td} hidden whitespace-nowrap sm:table-cell`}>
                      {i.dueDate ? (
                        <time dateTime={dueDay(i.dueDate)} className={overdue ? "font-medium text-red-700" : ""}>
                          {fmt.format(i.dueDate)}
                          {overdue && <span className="block text-xs">Overdue</span>}
                        </time>
                      ) : (
                        <span className="text-ink-soft">—</span>
                      )}
                    </td>
                    <td className={`${td} hidden lg:table-cell`}>{i.locationId ? locPath.get(i.locationId) : <span className="text-ink-soft">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
