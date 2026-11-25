// Pure Daily Logs logic: days, access rules, publishing, labour totals, item answers and
// the Open-Meteo weather request. No database access, so it can be unit-tested.
import { z } from "zod";
import { rank, type Level, type MemberContext } from "@/lib/permissions";
import { todayIn } from "@/modules/issues/logic";

// ---------- days ----------

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-25" when it is a real calendar day, otherwise null. */
export function parseDay(raw: unknown): string | null {
  if (typeof raw !== "string" || !DAY.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw ? raw : null;
}

/** Days are stored as UTC midnight of the calendar day. */
export const dayToDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const dateToDay = (d: Date) => d.toISOString().slice(0, 10);

/** A log can be kept for today or an earlier day in the project's time zone, never a future one. */
export const isFutureDay = (day: string, timeZone: string, now = new Date()) => day > todayIn(timeZone, now);

export function shiftDay(day: string, days: number) {
  const d = dayToDate(day);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToDay(d);
}

export const dayDiff = (a: string, b: string) => Math.round((dayToDate(a).getTime() - dayToDate(b).getTime()) / 86_400_000);

// ---------- access ----------

export type LogStatus = "DRAFT" | "PUBLISHED";
export const STATUS_LABELS: Record<LogStatus, string> = { DRAFT: "Draft", PUBLISHED: "Published" };
export const STATUS_COLORS: Record<LogStatus, string> = { DRAFT: "#f59e0b", PUBLISHED: "#16a34a" };

/** After publishing, a Creator can reopen a log for this long; after that only Daily Logs Managers. */
export const REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

const atLeast = (level: Level, min: Level) => rank(level) >= rank(min);

/**
 * What a member may do on a log:
 * - Viewers see logs. A Viewer who belongs to a company is a subcontractor contributor: while the
 *   log is a draft they add and edit their own company's labour/work rows and add photos;
 * - Creators start logs, edit every section of a draft, publish, and reopen within 24 h of publishing;
 * - Managers (and project admins) also reopen at any time, delete logs and edit the log template.
 */
export function dailyLogAccess(
  level: Level,
  member: Pick<MemberContext, "companyId"> | null,
  log: { status: LogStatus; publishedAt: Date | null } | null,
  now = new Date(),
) {
  const see = atLeast(level, "VIEWER");
  const creator = atLeast(level, "CREATOR");
  const manager = atLeast(level, "MANAGER");
  const draft = log?.status === "DRAFT";
  const published = log?.status === "PUBLISHED";
  const withinWindow = !!log?.publishedAt && now.getTime() - log.publishedAt.getTime() < REOPEN_WINDOW_MS;
  return {
    see,
    start: creator && !log,
    edit: see && creator && draft,
    /** add labour/work rows (own company only, unless a Creator) and photos */
    contribute: see && draft && (creator || !!member?.companyId),
    publish: creator && draft,
    reopen: published && (manager || (creator && withinWindow)),
    reopenNeedsManager: published && creator && !manager && !withinWindow,
    delete: manager && !!log,
    manageTemplate: manager,
  };
}
export type DailyLogAccess = ReturnType<typeof dailyLogAccess>;

/** May this member change a labour row? Creators any row; a contributor only their company's. */
export function canEditLabourRow(access: DailyLogAccess, level: Level, member: Pick<MemberContext, "companyId"> | null, row: { companyId: string | null }) {
  if (!access.contribute) return false;
  if (atLeast(level, "CREATOR")) return true;
  return !!member?.companyId && row.companyId === member.companyId;
}

// ---------- publishing ----------

export interface PublishFacts {
  workSummary: string | null;
  labour: { work: string | null }[];
  items: { label: string; required: boolean; value: string | null }[];
}

/** Reasons a draft can't be published yet (empty when it can). */
export function publishBlockers(log: PublishFacts, settings: { workLogRequired: boolean }): string[] {
  const out: string[] = [];
  if (settings.workLogRequired && !log.workSummary?.trim() && !log.labour.some((l) => l.work?.trim()))
    out.push("The work log is mandatory on this project: describe the work carried out (in the work log or a company's row).");
  for (const i of log.items) if (i.required && !i.value) out.push(`Answer the required item "${i.label}".`);
  return out;
}

export function labourTotals(rows: { headcount: number; hours: number }[]) {
  let headcount = 0;
  let manHours = 0;
  for (const r of rows) {
    headcount += r.headcount;
    manHours += r.headcount * r.hours;
  }
  return { headcount, manHours: Math.round(manHours * 10) / 10 };
}

// ---------- limits and input ----------

export const LIMITS = {
  text: 4000,
  short: 120,
  rowsPerSection: 100,
  templateItems: 50,
  headcount: 5000,
  hours: 24,
  quantity: 1000,
} as const;

const trimmed = (max: number, name: string) => z.string().trim().max(max, `${name} can be up to ${max} characters.`);
const optional = (max: number, name: string) =>
  trimmed(max, name)
    .optional()
    .transform((v) => v || null);
const number = (name: string, min: number, max: number, integer = false) =>
  z
    .string()
    .trim()
    .transform((v, c) => {
      const n = Number(v.replace(",", "."));
      if (!v || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
        c.addIssue({ code: "custom", message: `${name} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}.` });
        return z.NEVER;
      }
      return n;
    });
const optionalNumber = (name: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, c) => {
      if (!v) return null;
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n) || n < min || n > max) {
        c.addIssue({ code: "custom", message: `${name} must be a number from ${min} to ${max}.` });
        return z.NEVER;
      }
      return Math.round(n * 10) / 10;
    });
const time = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Times look like 07:30.")
  .transform((v) => v || null);

export const labourSchema = z.object({
  /** "" for a crew without a company, else a company id */
  companyId: z.string().max(64).transform((v) => v || null),
  crew: optional(LIMITS.short, "Crew name"),
  trade: optional(LIMITS.short, "Trade"),
  headcount: number("Headcount", 0, LIMITS.headcount, true),
  hours: number("Hours", 0, LIMITS.hours),
  work: optional(LIMITS.text, "Work carried out"),
});

export const equipmentSchema = z.object({
  name: trimmed(LIMITS.short, "Equipment").min(1, "Name the equipment."),
  quantity: number("Quantity", 1, LIMITS.quantity, true),
  hours: optionalNumber("Hours", 0, LIMITS.hours),
  notes: optional(500, "Notes"),
});

export const visitorSchema = z
  .object({
    name: trimmed(LIMITS.short, "Name").min(1, "Enter the visitor's name."),
    organisation: optional(LIMITS.short, "Organisation"),
    purpose: optional(500, "Purpose"),
    arrivedAt: time,
    leftAt: time,
  })
  .refine((v) => !v.arrivedAt || !v.leftAt || v.leftAt >= v.arrivedAt, { message: "The visitor can't leave before arriving." });

export const weatherSchema = z
  .object({
    conditions: optional(LIMITS.short, "Conditions"),
    tempMin: optionalNumber("Minimum temperature", -30, 60),
    tempMax: optionalNumber("Maximum temperature", -30, 60),
    precipitation: optionalNumber("Rain", 0, 1000),
    windMax: optionalNumber("Wind", 0, 400),
    weatherNote: optional(1000, "Weather note"),
  })
  .refine((w) => w.tempMin === null || w.tempMax === null || w.tempMin <= w.tempMax, { message: "The minimum temperature is above the maximum." });

export const logTextSchema = z.object({
  workSummary: optional(LIMITS.text, "Work carried out"),
  notes: optional(LIMITS.text, "Notes"),
});

export const coordinatesSchema = z
  .object({
    latitude: optionalNumber("Latitude", -90, 90),
    longitude: optionalNumber("Longitude", -180, 180),
  })
  .refine((c) => (c.latitude === null) === (c.longitude === null), { message: "Enter both latitude and longitude, or neither." });

export const ITEM_KINDS = ["YES_NO", "TEXT", "NUMBER"] as const;
export type LogItemKind = (typeof ITEM_KINDS)[number];
export const KIND_LABELS: Record<LogItemKind, string> = { YES_NO: "Yes / No / N/A", TEXT: "Text", NUMBER: "Number" };
export const YES_NO = ["YES", "NO", "NA"] as const;
export const YES_NO_LABELS: Record<(typeof YES_NO)[number], string> = { YES: "Yes", NO: "No", NA: "N/A" };

export const templateItemSchema = z.object({
  label: trimmed(200, "Item").min(1, "Enter the item's wording."),
  kind: z.enum(ITEM_KINDS, { message: "Choose an item type." }),
  required: z.boolean(),
});

/** Validates an answer for a log checklist item; blank clears it. */
export function normaliseItemAnswer(kind: LogItemKind, raw: string): { value: string | null } | { error: string } {
  const v = raw.trim();
  if (!v) return { value: null };
  if (kind === "YES_NO") return (YES_NO as readonly string[]).includes(v) ? { value: v } : { error: "Choose Yes, No or N/A." };
  if (kind === "NUMBER") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? { value: String(n) } : { error: "Enter a number." };
  }
  return v.length > 1000 ? { error: "Answers can be up to 1000 characters." } : { value: v };
}

export const itemAnswerText = (i: { kind: LogItemKind; value: string | null }) =>
  !i.value ? "" : i.kind === "YES_NO" ? (YES_NO_LABELS[i.value as keyof typeof YES_NO_LABELS] ?? i.value) : i.value;

/** Swaps an id with its neighbour; null when it can't move. */
export function moveInList(ids: string[], id: string, dir: "up" | "down"): string[] | null {
  const i = ids.indexOf(id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const out = [...ids];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

// ---------- weather (Open-Meteo) ----------

/** WMO weather interpretation codes used by Open-Meteo. */
export const WMO: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Heavy freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with heavy hail",
};
export const weatherText = (code: number | null | undefined) => (code === null || code === undefined ? null : (WMO[code] ?? `Weather code ${code}`));

/** The forecast API covers roughly the last three months; older days use the archive. */
export const FORECAST_PAST_DAYS = 90;
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max";

/** Open-Meteo request for one day's weather at the project's coordinates. `base` overrides both hosts (tests). */
export function openMeteoUrl(opts: { latitude: number; longitude: number; day: string; timeZone: string; today: string; base?: string }) {
  const archive = dayDiff(opts.today, opts.day) > FORECAST_PAST_DAYS;
  const host = opts.base?.replace(/\/$/, "") ?? (archive ? "https://archive-api.open-meteo.com" : "https://api.open-meteo.com");
  const q = new URLSearchParams({
    latitude: opts.latitude.toFixed(4),
    longitude: opts.longitude.toFixed(4),
    daily: DAILY,
    timezone: opts.timeZone,
    start_date: opts.day,
    end_date: opts.day,
    wind_speed_unit: "kmh",
  });
  return `${host}/v1/${archive ? "archive" : "forecast"}?${q}`;
}

const dailySchema = z.object({
  daily: z.object({
    time: z.array(z.string()).min(1),
    weather_code: z.array(z.number().nullable()).optional(),
    temperature_2m_max: z.array(z.number().nullable()).optional(),
    temperature_2m_min: z.array(z.number().nullable()).optional(),
    precipitation_sum: z.array(z.number().nullable()).optional(),
    wind_speed_10m_max: z.array(z.number().nullable()).optional(),
  }),
});

export interface Weather {
  weatherCode: number | null;
  conditions: string | null;
  tempMin: number | null;
  tempMax: number | null;
  precipitation: number | null;
  windMax: number | null;
}

/** Reads an Open-Meteo daily response for `day`; null when it doesn't hold that day. */
export function parseOpenMeteo(json: unknown, day: string): Weather | null {
  const parsed = dailySchema.safeParse(json);
  if (!parsed.success) return null;
  const d = parsed.data.daily;
  const i = d.time.indexOf(day);
  if (i < 0) return null;
  const at = (a?: (number | null)[]) => {
    const v = a?.[i];
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  };
  const code = at(d.weather_code);
  const w = { weatherCode: code === null ? null : Math.round(code), tempMin: at(d.temperature_2m_min), tempMax: at(d.temperature_2m_max), precipitation: at(d.precipitation_sum), windMax: at(d.wind_speed_10m_max) };
  if (Object.values(w).every((v) => v === null)) return null;
  return { ...w, conditions: weatherText(w.weatherCode) };
}

export function weatherSummary(w: { conditions: string | null; tempMin: number | null; tempMax: number | null; precipitation: number | null; windMax: number | null }) {
  const parts: string[] = [];
  if (w.conditions) parts.push(w.conditions);
  if (w.tempMin !== null && w.tempMax !== null) parts.push(`${w.tempMin}–${w.tempMax} °C`);
  else if (w.tempMax !== null) parts.push(`max ${w.tempMax} °C`);
  else if (w.tempMin !== null) parts.push(`min ${w.tempMin} °C`);
  if (w.precipitation !== null) parts.push(`${w.precipitation} mm rain`);
  if (w.windMax !== null) parts.push(`wind ${w.windMax} km/h`);
  return parts.join(", ");
}
