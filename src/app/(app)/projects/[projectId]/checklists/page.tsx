import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { badge, btn, btnGhost, card, input, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { STATUS_COLORS, STATUS_LABELS, checklistLabel, parseListFilters, progress } from "@/modules/checklists/logic";
import { getChecklistsContext } from "@/modules/checklists/server";
import { isOverdue, dueDay } from "@/modules/issues/logic";

const PAGE = 300;
const STATUS_TABS = [
  { id: "", label: "All" },
  { id: "OPEN", label: "Open" },
  { id: "NOT_STARTED", label: "Not started" },
  { id: "IN_PROGRESS", label: "In progress" },
  { id: "COMPLETED", label: "Completed" },
] as const;

export default async function ChecklistsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId } = await params;
  const ctx = await getChecklistsContext(projectId);
  const f = parseListFilters(await searchParams);
  const base = `/projects/${projectId}/checklists`;
  const where: Prisma.ChecklistWhereInput = { projectId };
  if (f.status === "OPEN") where.status = { not: "COMPLETED" };
  else if (f.status) where.status = f.status;
  if (f.mine) {
    where.OR = [
      { assigneeType: "USER", assigneeId: ctx.user.id },
      ...(ctx.member?.companyId ? [{ assigneeType: "COMPANY" as const, assigneeId: ctx.member.companyId }] : []),
    ];
  }
  if (f.q) {
    const n = /^(?:cl-?)?(\d{1,9})$/i.exec(f.q);
    where.AND = [{ OR: [{ title: { contains: f.q, mode: "insensitive" } }, { templateName: { contains: f.q, mode: "insensitive" } }, ...(n ? [{ number: Number(n[1]) }] : [])] }];
  }
  const [checklists, total] = await Promise.all([
    db.checklist.findMany({
      where,
      include: { items: { select: { kind: true, value: true, required: true, label: true, _count: { select: { photos: true } } } } },
      orderBy: { number: "desc" },
      take: PAGE,
    }),
    db.checklist.count({ where }),
  ]);
  const locPath = new Map(ctx.locationPaths.map((l) => [l.id, l.path]));
  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "UTC" });
  const href = (p: Partial<typeof f>) => {
    const m = { ...f, ...p };
    const q = new URLSearchParams({ ...(m.status ? { status: m.status } : {}), ...(m.mine ? { mine: "1" } : {}), ...(m.q ? { q: m.q } : {}) }).toString();
    return q ? `${base}?${q}` : base;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Checklists</h2>
        {ctx.canCreate && <Link href={`${base}/new`} className={btn}>New checklist</Link>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Checklist status" className="flex overflow-x-auto rounded-md border border-line">
          {STATUS_TABS.map((t) => (
            <Link
              key={t.id}
              href={href({ status: t.id })}
              aria-current={f.status === t.id ? "page" : undefined}
              className={`whitespace-nowrap px-3 py-1.5 text-sm font-medium ${f.status === t.id ? "bg-brand text-white" : "bg-surface hover:bg-muted"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <Link href={href({ mine: !f.mine })} aria-pressed={f.mine} className={`${btnGhost} ${f.mine ? "border-brand text-brand" : ""}`}>
          Assigned to me
        </Link>
        <form key={f.q} className="flex w-full gap-2 sm:max-w-xs" role="search" action={base}>
          {f.status && <input type="hidden" name="status" value={f.status} />}
          {f.mine && <input type="hidden" name="mine" value="1" />}
          <input className={input} type="search" name="q" defaultValue={f.q} aria-label="Search checklists" placeholder="Title, template or CL-ID" />
          <button className={btnGhost} type="submit">Search</button>
        </form>
      </div>

      <p className="text-sm text-ink-soft" data-testid="checklist-count">
        {total === 1 ? "1 checklist" : `${total} checklists`}
        {total > PAGE && ` (showing the newest ${PAGE})`}
      </p>

      {checklists.length === 0 ? (
        <div className={`${card} p-8 text-center text-sm text-ink-soft`}>
          {f.status || f.mine || f.q ? "No checklists match." : "No checklists yet. Start one from a template: snag lists, inspections, commissioning."}
        </div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full" data-testid="checklists-table">
            <thead className="border-b border-line bg-muted/50">
              <tr>
                <th className="w-1.5 p-0"><span className="sr-only">Status colour</span></th>
                <th className={`${th} w-16`}>ID</th>
                <th className={th}>Checklist</th>
                <th className={th}>Progress</th>
                <th className={`${th} hidden md:table-cell`}>Assigned to</th>
                <th className={`${th} hidden sm:table-cell`}>Due</th>
                <th className={`${th} hidden lg:table-cell`}>Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {checklists.map((c) => {
                const p = progress(c.items.map((i) => ({ ...i, photoCount: i._count.photos })));
                const overdue = isOverdue(c.dueDate, c.status === "COMPLETED", ctx.project.timezone);
                const assignee = ctx.assigneeName(c.assigneeType, c.assigneeId);
                return (
                  <tr key={c.id} data-testid="checklist-row">
                    <td className="w-1.5 p-0" style={{ background: STATUS_COLORS[c.status] }} aria-hidden />
                    <td className={`${td} whitespace-nowrap text-ink-soft`}>{checklistLabel(c.number)}</td>
                    <td className={td}>
                      <p className="text-xs text-ink-soft">{c.templateName}</p>
                      <Link href={`${base}/${c.id}`} className="font-medium break-words hover:underline">{c.title}</Link>
                      <p className="mt-1 text-xs text-ink-soft md:hidden">{assignee}</p>
                    </td>
                    <td className={`${td} min-w-32`}>
                      <span className={`${badge} whitespace-nowrap`} style={{ background: `${STATUS_COLORS[c.status]}22`, boxShadow: `inset 0 0 0 1px ${STATUS_COLORS[c.status]}` }} data-testid="checklist-status">
                        {STATUS_LABELS[c.status]}
                      </span>
                      <div className="mt-1.5 h-1.5 w-full max-w-32 rounded-full bg-muted" aria-hidden>
                        <div className="h-1.5 rounded-full bg-brand" style={{ width: `${p.percent}%` }} />
                      </div>
                      <p className="mt-0.5 text-xs text-ink-soft" data-testid="checklist-progress">
                        {p.answered}/{p.total}
                        {p.failed > 0 && <span className="text-red-700"> · {p.failed} failed</span>}
                      </p>
                    </td>
                    <td className={`${td} hidden md:table-cell`}>{assignee ?? <span className="text-ink-soft">Unassigned</span>}</td>
                    <td className={`${td} hidden whitespace-nowrap sm:table-cell`}>
                      {c.dueDate ? (
                        <time dateTime={dueDay(c.dueDate)} className={overdue ? "font-medium text-red-700" : ""}>
                          {fmt.format(c.dueDate)}
                          {overdue && <span className="block text-xs">Overdue</span>}
                        </time>
                      ) : (
                        <span className="text-ink-soft">—</span>
                      )}
                    </td>
                    <td className={`${td} hidden lg:table-cell`}>{c.locationId ? locPath.get(c.locationId) : <span className="text-ink-soft">—</span>}</td>
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
