import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, btn, btnGhost, card, input, label, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { startLog } from "@/modules/daily-logs/actions";
import { STATUS_COLORS, STATUS_LABELS, dateToDay, labourTotals, parseDay, weatherSummary } from "@/modules/daily-logs/logic";
import { getDailyLogsContext } from "@/modules/daily-logs/server";

const PAGE = 120;

export default async function DailyLogsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ status?: string; from?: string; to?: string }> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const ctx = await getDailyLogsContext(projectId);
  const base = `/projects/${projectId}/daily-logs`;
  const status: "DRAFT" | "PUBLISHED" | null = sp.status === "DRAFT" || sp.status === "PUBLISHED" ? sp.status : null;
  const from = parseDay(sp.from);
  const to = parseDay(sp.to);
  const where: Prisma.DailyLogWhereInput = {
    projectId,
    ...(status ? { status } : {}),
    ...(from || to ? { date: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}) } } : {}),
  };
  const [logs, total, today] = await Promise.all([
    db.dailyLog.findMany({
      where,
      orderBy: { date: "desc" },
      take: PAGE,
      include: { labour: { select: { headcount: true, hours: true } }, createdBy: { select: { name: true } }, _count: { select: { photos: true, visitors: true } } },
    }),
    db.dailyLog.count({ where }),
    db.dailyLog.findUnique({ where: { projectId_date: { projectId, date: new Date(`${ctx.today}T00:00:00Z`) } }, select: { status: true } }),
  ]);
  const long = new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const tab = (s: string | null) => `${base}?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Daily Logs</h2>
          <p className="text-sm text-ink-soft">One log per day: weather, labour per company, equipment, visitors, notes and photos.</p>
        </div>
        {today ? (
          <Link href={`${base}/${ctx.today}`} className={btn} data-testid="today-log">Open today&apos;s log</Link>
        ) : (
          ctx.canCreate && (
            <ActionForm action={startLog.bind(null, projectId)} testId="start-today-form">
              <input type="hidden" name="date" value={ctx.today} />
              <SubmitButton>Start today&apos;s log</SubmitButton>
            </ActionForm>
          )
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <nav aria-label="Log status" className="flex overflow-x-auto rounded-md border border-line">
          {[null, "DRAFT", "PUBLISHED"].map((s) => (
            <Link
              key={s ?? "all"}
              href={tab(s)}
              aria-current={status === s ? "page" : undefined}
              className={`whitespace-nowrap px-3 py-1.5 text-sm font-medium ${status === s ? "bg-brand text-white" : "bg-surface hover:bg-muted"}`}
            >
              {s ? STATUS_LABELS[s as keyof typeof STATUS_LABELS] : "All"}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-end gap-2" action={base} aria-label="Date range">
          {status && <input type="hidden" name="status" value={status} />}
          <div>
            <label className={label} htmlFor="from">From</label>
            <input id="from" name="from" type="date" className={input} defaultValue={from ?? ""} />
          </div>
          <div>
            <label className={label} htmlFor="to">To</label>
            <input id="to" name="to" type="date" className={input} defaultValue={to ?? ""} />
          </div>
          <button type="submit" className={btnGhost}>Show</button>
        </form>
        <form className="flex items-end gap-2 sm:ml-auto" action={`${base}/go`} aria-label="Open a day">
          <div>
            <label className={label} htmlFor="go-day">Open a day</label>
            <input id="go-day" name="day" type="date" className={input} max={ctx.today} defaultValue={ctx.today} required />
          </div>
          <button type="submit" className={btnGhost}>Open</button>
        </form>
      </div>

      <p className="text-sm text-ink-soft" data-testid="log-count">
        {total === 1 ? "1 log" : `${total} logs`}
        {total > PAGE && ` (showing the newest ${PAGE})`}
      </p>

      {logs.length === 0 ? (
        <div className={`${card} p-8 text-center text-sm text-ink-soft`}>{status || from || to ? "No logs match." : "No daily logs yet."}</div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full" data-testid="logs-table">
            <thead className="border-b border-line bg-muted/50">
              <tr>
                <th className="w-1.5 p-0"><span className="sr-only">Status colour</span></th>
                <th className={th}>Date</th>
                <th className={th}>Labour</th>
                <th className={`${th} hidden sm:table-cell`}>Weather</th>
                <th className={`${th} hidden md:table-cell`}>Started by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {logs.map((l) => {
                const day = dateToDay(l.date);
                const t = labourTotals(l.labour);
                return (
                  <tr key={l.id} data-testid="log-row">
                    <td className="w-1.5 p-0" style={{ background: STATUS_COLORS[l.status] }} aria-hidden />
                    <td className={td}>
                      <Link href={`${base}/${day}`} className="font-medium hover:underline">{long.format(l.date)}</Link>
                      <div className="mt-1">
                        <span className={badge} style={{ background: `${STATUS_COLORS[l.status]}22`, boxShadow: `inset 0 0 0 1px ${STATUS_COLORS[l.status]}` }} data-testid="log-status">
                          {STATUS_LABELS[l.status]}
                        </span>
                        {l._count.photos > 0 && <span className="ml-2 text-xs text-ink-soft">{l._count.photos} photos</span>}
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap`} data-testid="log-labour">
                      {t.headcount} people
                      <span className="block text-xs text-ink-soft">{t.manHours} man-hours</span>
                    </td>
                    <td className={`${td} hidden sm:table-cell`}>{weatherSummary(l) || <span className="text-ink-soft">—</span>}</td>
                    <td className={`${td} hidden md:table-cell`}>{l.createdBy?.name ?? "Former member"}</td>
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
