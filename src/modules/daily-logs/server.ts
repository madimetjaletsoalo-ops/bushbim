import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";
import { can, effectiveLevel } from "@/lib/permissions";
import { todayIn } from "@/modules/issues/logic";
import { dailyLogAccess, dayToDate, openMeteoUrl, parseDay, parseOpenMeteo, type LogStatus, type Weather } from "./logic";

/** Project context, the member's Daily Logs level and the lists the forms need, once per request. */
export const getDailyLogsContext = cache(async (projectId: string) => {
  const ctx = await getProjectContext(projectId);
  const level = effectiveLevel(ctx.member, "DAILY_LOGS", ctx.grants);
  const [companies, settings] = await Promise.all([
    db.company.findMany({ where: { accountId: ctx.user.accountId }, orderBy: { name: "asc" }, select: { id: true, name: true, trade: true } }),
    db.dailyLogSettings.findUnique({ where: { projectId } }),
  ]);
  const ownCompany = ctx.member?.companyId ? (companies.find((c) => c.id === ctx.member!.companyId) ?? null) : null;
  return {
    ...ctx,
    level,
    canView: can(ctx.member, "DAILY_LOGS", "view", ctx.grants),
    canCreate: can(ctx.member, "DAILY_LOGS", "create", ctx.grants),
    canManage: can(ctx.member, "DAILY_LOGS", "manage", ctx.grants),
    companies,
    ownCompany,
    settings: { workLogRequired: settings?.workLogRequired ?? false },
    today: todayIn(ctx.project.timezone),
    accessFor: (log: { status: LogStatus; publishedAt: Date | null } | null) => dailyLogAccess(level, ctx.member, log),
  };
});
export type DailyLogsContext = Awaited<ReturnType<typeof getDailyLogsContext>>;

/** A project's log for a day, with everything the page and the PDF show. */
export async function loadLogFull(projectId: string, day: string) {
  if (!parseDay(day)) return null;
  return db.dailyLog.findUnique({
    where: { projectId_date: { projectId, date: dayToDate(day) } },
    include: {
      createdBy: { select: { name: true } },
      publishedBy: { select: { name: true } },
      labour: { orderBy: [{ companyName: "asc" }, { createdAt: "asc" }], include: { createdBy: { select: { name: true } } } },
      equipment: { orderBy: { createdAt: "asc" } },
      visitors: { orderBy: [{ arrivedAt: "asc" }, { createdAt: "asc" }] },
      items: { orderBy: { order: "asc" }, include: { answeredBy: { select: { name: true } } } },
      photos: { orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, thumbKey: true, caption: true, uploadedById: true, width: true, height: true, createdAt: true, uploadedBy: { select: { name: true } } } },
    },
  });
}
export type DailyLogFull = NonNullable<Awaited<ReturnType<typeof loadLogFull>>>;

const WEATHER_TIMEOUT_MS = 5000;

/**
 * The day's weather from Open-Meteo at the project's coordinates. Null when the project has no
 * coordinates, the service is switched off (OPEN_METEO_URL=off) or can't be reached in time.
 */
export async function fetchWeather(project: { latitude: number | null; longitude: number | null; timezone: string }, day: string): Promise<Weather | null> {
  if (project.latitude === null || project.longitude === null) return null;
  const base = process.env.OPEN_METEO_URL || undefined;
  if (base === "off") return null;
  const url = openMeteoUrl({ latitude: project.latitude, longitude: project.longitude, day, timeZone: project.timezone, today: todayIn(project.timezone), base });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS), cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return parseOpenMeteo(await res.json(), day);
  } catch (e) {
    console.warn("daily-logs: weather lookup failed", (e as Error).message);
    return null;
  }
}
