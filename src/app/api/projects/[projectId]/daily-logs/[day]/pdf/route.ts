import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { contentDisposition } from "@/modules/docs/logic";
import { buildDailyLogPdf, type DailyLogReport } from "@/modules/daily-logs/export";
import { STATUS_LABELS, itemAnswerText, labourTotals, weatherSummary } from "@/modules/daily-logs/logic";
import { getDailyLogsContext, loadLogFull } from "@/modules/daily-logs/server";

const MAX_PHOTOS = 24;

/** PDF of a day's log for anyone with Daily Logs access. Photos are embedded as thumbnails to keep it small. */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string; day: string }> }) {
  const { projectId, day } = await params;
  const ctx = await getDailyLogsContext(projectId);
  const log = ctx.canView ? await loadLogFull(projectId, day) : null;
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.project.timezone });
  const long = new Intl.DateTimeFormat("en-ZA", { dateStyle: "full", timeZone: "UTC" });
  const totals = labourTotals(log.labour);
  try {
    const storage = getStorage();
    const photos: DailyLogReport["photos"] = [];
    for (const p of log.photos.slice(0, MAX_PHOTOS)) {
      try {
        photos.push({ bytes: await storage.read(p.thumbKey), caption: p.caption ?? `${p.uploadedBy?.name ?? "Former member"}, ${fmt.format(p.createdAt)}` });
      } catch (e) {
        console.error("daily-logs: couldn't read photo", p.id, e);
      }
    }
    const weather = weatherSummary(log);
    const report: DailyLogReport = {
      title: `Daily log ${day}`,
      lines: [
        ["Project", ctx.project.name],
        ["Date", long.format(log.date)],
        ["Status", log.status === "PUBLISHED" && log.publishedAt ? `${STATUS_LABELS.PUBLISHED} ${fmt.format(log.publishedAt)} by ${log.publishedBy?.name ?? "former member"}` : STATUS_LABELS.DRAFT],
        ["Started", `${fmt.format(log.createdAt)} by ${log.createdBy?.name ?? "former member"}`],
        ["Labour", `${totals.headcount} people, ${totals.manHours} man-hours`],
      ],
      sections: [
        {
          title: "Weather",
          text: [
            weather ? `${weather}${log.weatherSource === "AUTO" ? " (Open-Meteo)" : log.weatherSource === "MANUAL" ? " (entered on site)" : ""}` : "Not recorded.",
            ...(log.weatherNote ? [`Note: ${log.weatherNote}`] : []),
          ],
        },
        {
          title: "Labour and work",
          table: {
            head: ["Company / crew", "Trade", "People", "Hours", "Work carried out"],
            widths: [0.22, 0.14, 0.09, 0.09, 0.46],
            rows: log.labour.map((l) => [l.companyName, l.trade ?? "", String(l.headcount), String(l.hours), l.work ?? ""]),
            foot: log.labour.length ? ["Total", "", String(totals.headcount), `${totals.manHours} man-h`, ""] : undefined,
          },
        },
        { title: "Work log", text: [log.workSummary ?? "Not recorded."] },
        {
          title: "Equipment",
          table: { head: ["Equipment", "Qty", "Hours", "Notes"], widths: [0.35, 0.1, 0.1, 0.45], rows: log.equipment.map((e) => [e.name, String(e.quantity), e.hours === null ? "" : String(e.hours), e.notes ?? ""]) },
        },
        {
          title: "Visitors",
          table: {
            head: ["Name", "Organisation", "Purpose", "In", "Out"],
            widths: [0.22, 0.22, 0.36, 0.1, 0.1],
            rows: log.visitors.map((v) => [v.name, v.organisation ?? "", v.purpose ?? "", v.arrivedAt ?? "", v.leftAt ?? ""]),
          },
        },
        ...(log.items.length
          ? [
              {
                title: "Checklist",
                table: {
                  head: ["Item", "Answer", "By"],
                  widths: [0.55, 0.15, 0.3],
                  rows: log.items.map((i) => [`${i.label}${i.required ? " *" : ""}`, itemAnswerText(i) || "Not answered", i.answeredAt ? `${i.answeredBy?.name ?? "Former member"}, ${fmt.format(i.answeredAt)}` : ""]),
                },
              },
            ]
          : []),
        { title: "Notes", text: [log.notes ?? "None."] },
      ],
      photos,
    };
    const pdf = await buildDailyLogPdf(report);
    await db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "daily_log.exported", details: { logId: log.id, date: day } } });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(`Daily log ${day} - ${ctx.project.name}.pdf`),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("daily-logs: export failed", e);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
