import { describe, expect, it } from "vitest";
import {
  REOPEN_WINDOW_MS,
  canEditLabourRow,
  coordinatesSchema,
  dailyLogAccess,
  dayDiff,
  equipmentSchema,
  isFutureDay,
  itemAnswerText,
  labourSchema,
  labourTotals,
  moveInList,
  normaliseItemAnswer,
  openMeteoUrl,
  parseDay,
  parseOpenMeteo,
  publishBlockers,
  shiftDay,
  visitorSchema,
  weatherSchema,
  weatherSummary,
  weatherText,
} from "@/modules/daily-logs/logic";

const now = new Date("2026-11-25T10:00:00Z");
const draft = { status: "DRAFT" as const, publishedAt: null };
const publishedAgo = (ms: number) => ({ status: "PUBLISHED" as const, publishedAt: new Date(now.getTime() - ms) });
const sub = { companyId: "c1" };
const gc = { companyId: null };

describe("days", () => {
  it("parses only real calendar days", () => {
    expect(parseDay("2026-11-25")).toBe("2026-11-25");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("25/11/2026")).toBeNull();
    expect(parseDay(undefined)).toBeNull();
  });
  it("knows future days in the project's time zone", () => {
    // 23:30 UTC on the 24th is already the 25th in Johannesburg (UTC+2)
    const late = new Date("2026-11-24T23:30:00Z");
    expect(isFutureDay("2026-11-25", "Africa/Johannesburg", late)).toBe(false);
    expect(isFutureDay("2026-11-25", "UTC", late)).toBe(true);
    expect(isFutureDay("2026-11-24", "UTC", late)).toBe(false);
  });
  it("shifts and diffs days across month ends", () => {
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(dayDiff("2026-12-01", "2026-11-25")).toBe(6);
  });
});

describe("dailyLogAccess", () => {
  it("lets Creators start, edit and publish drafts", () => {
    expect(dailyLogAccess("CREATOR", gc, null, now).start).toBe(true);
    const a = dailyLogAccess("CREATOR", gc, draft, now);
    expect(a).toMatchObject({ see: true, start: false, edit: true, contribute: true, publish: true, reopen: false, delete: false, manageTemplate: false });
  });
  it("gives Viewers from a company contributor rights on drafts only", () => {
    expect(dailyLogAccess("VIEWER", sub, draft, now)).toMatchObject({ see: true, edit: false, contribute: true, publish: false, start: false });
    expect(dailyLogAccess("VIEWER", gc, draft, now).contribute).toBe(false);
    expect(dailyLogAccess("VIEWER", sub, publishedAgo(1000), now).contribute).toBe(false);
  });
  it("locks published logs", () => {
    const a = dailyLogAccess("MANAGER", gc, publishedAgo(1000), now);
    expect(a.edit).toBe(false);
    expect(a.contribute).toBe(false);
    expect(a.publish).toBe(false);
  });
  it("lets Creators reopen within 24 h, then only Managers", () => {
    expect(dailyLogAccess("CREATOR", gc, publishedAgo(REOPEN_WINDOW_MS - 60_000), now).reopen).toBe(true);
    const late = dailyLogAccess("CREATOR", gc, publishedAgo(REOPEN_WINDOW_MS + 60_000), now);
    expect(late.reopen).toBe(false);
    expect(late.reopenNeedsManager).toBe(true);
    expect(dailyLogAccess("MANAGER", gc, publishedAgo(REOPEN_WINDOW_MS * 30), now).reopen).toBe(true);
    expect(dailyLogAccess("VIEWER", sub, publishedAgo(1000), now).reopen).toBe(false);
  });
  it("hides everything without access", () => {
    expect(dailyLogAccess("NONE", sub, draft, now)).toMatchObject({ see: false, contribute: false, edit: false });
  });
  it("limits contributors to their own company's rows", () => {
    const v = dailyLogAccess("VIEWER", sub, draft, now);
    expect(canEditLabourRow(v, "VIEWER", sub, { companyId: "c1" })).toBe(true);
    expect(canEditLabourRow(v, "VIEWER", sub, { companyId: "c2" })).toBe(false);
    expect(canEditLabourRow(v, "VIEWER", sub, { companyId: null })).toBe(false);
    const c = dailyLogAccess("CREATOR", gc, draft, now);
    expect(canEditLabourRow(c, "CREATOR", gc, { companyId: "c2" })).toBe(true);
    const locked = dailyLogAccess("MANAGER", gc, publishedAgo(1), now);
    expect(canEditLabourRow(locked, "MANAGER", gc, { companyId: "c2" })).toBe(false);
  });
});

describe("publishBlockers", () => {
  const empty = { workSummary: null, labour: [], items: [] };
  it("allows an empty log when the work log is optional", () => {
    expect(publishBlockers(empty, { workLogRequired: false })).toEqual([]);
  });
  it("needs the work log when mandatory, from the summary or a company's row", () => {
    expect(publishBlockers(empty, { workLogRequired: true })).toHaveLength(1);
    expect(publishBlockers({ ...empty, workSummary: "  " }, { workLogRequired: true })).toHaveLength(1);
    expect(publishBlockers({ ...empty, workSummary: "Poured slab" }, { workLogRequired: true })).toEqual([]);
    expect(publishBlockers({ ...empty, labour: [{ work: null }, { work: "Thatching" }] }, { workLogRequired: true })).toEqual([]);
  });
  it("needs required checklist items answered", () => {
    const items = [
      { label: "Toolbox talk held", required: true, value: null },
      { label: "Optional", required: false, value: null },
    ];
    expect(publishBlockers({ ...empty, items }, { workLogRequired: false })).toEqual(['Answer the required item "Toolbox talk held".']);
  });
});

describe("labour", () => {
  it("totals headcount and man-hours", () => {
    expect(labourTotals([{ headcount: 12, hours: 8 }, { headcount: 3, hours: 7.5 }])).toEqual({ headcount: 15, manHours: 118.5 });
    expect(labourTotals([])).toEqual({ headcount: 0, manHours: 0 });
  });
  it("validates rows", () => {
    expect(labourSchema.safeParse({ companyId: "", crew: "Local crew", trade: "", headcount: "12", hours: "8", work: "" }).data).toEqual({
      companyId: null,
      crew: "Local crew",
      trade: null,
      headcount: 12,
      hours: 8,
      work: null,
    });
    expect(labourSchema.safeParse({ companyId: "c1", headcount: "2.5", hours: "8" }).success).toBe(false);
    expect(labourSchema.safeParse({ companyId: "c1", headcount: "2", hours: "25" }).success).toBe(false);
    expect(labourSchema.safeParse({ companyId: "c1", headcount: "", hours: "8" }).success).toBe(false);
    expect(labourSchema.safeParse({ companyId: "c1", headcount: "4", hours: "7,5" }).data?.hours).toBe(7.5);
  });
});

describe("other inputs", () => {
  it("validates equipment and visitors", () => {
    expect(equipmentSchema.safeParse({ name: "TLB", quantity: "1", hours: "", notes: "" }).data).toEqual({ name: "TLB", quantity: 1, hours: null, notes: null });
    expect(equipmentSchema.safeParse({ name: "", quantity: "1" }).success).toBe(false);
    expect(visitorSchema.safeParse({ name: "Dr Mokoena", arrivedAt: "09:00", leftAt: "11:30" }).success).toBe(true);
    expect(visitorSchema.safeParse({ name: "Dr Mokoena", arrivedAt: "11:00", leftAt: "09:30" }).success).toBe(false);
    expect(visitorSchema.safeParse({ name: "Dr Mokoena", arrivedAt: "9am" }).success).toBe(false);
  });
  it("validates weather and coordinates", () => {
    expect(weatherSchema.safeParse({ conditions: "Rain", tempMin: "18", tempMax: "29.44" }).data).toMatchObject({ tempMin: 18, tempMax: 29.4, precipitation: null });
    expect(weatherSchema.safeParse({ tempMin: "30", tempMax: "20" }).success).toBe(false);
    expect(coordinatesSchema.safeParse({ latitude: "-24.39", longitude: "31.62" }).data).toEqual({ latitude: -24.4, longitude: 31.6 });
    expect(coordinatesSchema.safeParse({ latitude: "", longitude: "" }).data).toEqual({ latitude: null, longitude: null });
    expect(coordinatesSchema.safeParse({ latitude: "-24", longitude: "" }).success).toBe(false);
    expect(coordinatesSchema.safeParse({ latitude: "-95", longitude: "31" }).success).toBe(false);
  });
  it("normalises checklist answers", () => {
    expect(normaliseItemAnswer("YES_NO", "NO")).toEqual({ value: "NO" });
    expect(normaliseItemAnswer("YES_NO", "maybe")).toHaveProperty("error");
    expect(normaliseItemAnswer("NUMBER", "3,5")).toEqual({ value: "3.5" });
    expect(normaliseItemAnswer("NUMBER", "lots")).toHaveProperty("error");
    expect(normaliseItemAnswer("TEXT", "  ")).toEqual({ value: null });
    expect(itemAnswerText({ kind: "YES_NO", value: "NA" })).toBe("N/A");
  });
  it("moves template items", () => {
    expect(moveInList(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveInList(["a", "b"], "a", "up")).toBeNull();
  });
});

describe("Open-Meteo", () => {
  const opts = { latitude: -24.391, longitude: 31.6234, timeZone: "Africa/Johannesburg", today: "2026-11-25" };
  it("uses the forecast API for recent days and the archive for old ones", () => {
    const recent = new URL(openMeteoUrl({ ...opts, day: "2026-11-24" }));
    expect(recent.host).toBe("api.open-meteo.com");
    expect(recent.pathname).toBe("/v1/forecast");
    expect(recent.searchParams.get("start_date")).toBe("2026-11-24");
    expect(recent.searchParams.get("latitude")).toBe("-24.3910");
    expect(recent.searchParams.get("timezone")).toBe("Africa/Johannesburg");
    const old = new URL(openMeteoUrl({ ...opts, day: "2026-01-10" }));
    expect(old.host).toBe("archive-api.open-meteo.com");
    expect(old.pathname).toBe("/v1/archive");
    expect(new URL(openMeteoUrl({ ...opts, day: "2026-11-24", base: "http://localhost:9/" })).origin).toBe("http://localhost:9");
  });
  it("reads a daily response", () => {
    const json = {
      daily: {
        time: ["2026-11-24"],
        weather_code: [95],
        temperature_2m_max: [31.26],
        temperature_2m_min: [19.04],
        precipitation_sum: [12.4],
        wind_speed_10m_max: [22.9],
      },
    };
    const w = parseOpenMeteo(json, "2026-11-24");
    expect(w).toEqual({ weatherCode: 95, conditions: "Thunderstorm", tempMin: 19, tempMax: 31.3, precipitation: 12.4, windMax: 22.9 });
    expect(weatherSummary(w!)).toBe("Thunderstorm, 19–31.3 °C, 12.4 mm rain, wind 22.9 km/h");
    expect(parseOpenMeteo(json, "2026-11-23")).toBeNull();
    expect(parseOpenMeteo({ error: true, reason: "bad" }, "2026-11-24")).toBeNull();
    expect(parseOpenMeteo({ daily: { time: ["2026-11-24"], weather_code: [null] } }, "2026-11-24")).toBeNull();
  });
  it("describes WMO codes", () => {
    expect(weatherText(0)).toBe("Clear sky");
    expect(weatherText(42)).toBe("Weather code 42");
    expect(weatherText(null)).toBeNull();
  });
});

describe("buildDailyLogPdf", () => {
  it("writes a PDF with long tables across pages", async () => {
    const { buildDailyLogPdf } = await import("@/modules/daily-logs/export");
    const { PDFDocument } = await import("pdf-lib");
    const rows = Array.from({ length: 80 }, (_, i) => [`Company ${i}`, "Thatching", "12", "8", "Re-thatched the boma roof ".repeat(4)]);
    const bytes = await buildDailyLogPdf({
      title: "Daily log 2026-11-25",
      lines: [["Project", "Timbavati Boma — Phase 2"]],
      sections: [
        { title: "Weather", text: ["Thunderstorm, 19–31 °C"] },
        { title: "Labour and work", table: { head: ["Company", "Trade", "People", "Hours", "Work"], widths: [0.22, 0.14, 0.09, 0.09, 0.46], rows, foot: ["Total", "", "960", "7680", ""] } },
        { title: "Visitors", table: { head: ["Name"], widths: [1], rows: [] } },
      ],
      photos: [],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe("Daily log 2026-11-25");
  });
});
