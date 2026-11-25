import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { contentDisposition } from "@/modules/docs/logic";
import { buildChecklistPdf, type ChecklistReport } from "@/modules/checklists/export";
import { STATUS_LABELS, answerText, checklistLabel, isFailed, progress } from "@/modules/checklists/logic";
import { accessFor, getChecklistsContext, loadChecklistFull } from "@/modules/checklists/server";
import { issueLabel } from "@/modules/issues/logic";

const MAX_PHOTOS_PER_ITEM = 6;

/** PDF of a checklist's result for anyone who can see it. Photos are embedded as thumbnails to keep it small. */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string; checklistId: string }> }) {
  const { projectId, checklistId } = await params;
  const ctx = await getChecklistsContext(projectId);
  const c = ctx.canView ? await loadChecklistFull(projectId, checklistId) : null;
  if (!c || !accessFor(ctx, c).see) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.project.timezone });
  const day = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "UTC" });
  const items = c.sections.flatMap((s) => s.items.map((i) => ({ ...i, photoCount: i.photos.length })));
  const p = progress(items);
  const location = c.locationId ? ctx.locationPaths.find((l) => l.id === c.locationId)?.path : null;

  try {
    const storage = getStorage();
    const report: ChecklistReport = {
      title: `${checklistLabel(c.number)}: ${c.title}`,
      lines: [
        ["Project", ctx.project.name],
        ["Template", c.templateName],
        ["Status", STATUS_LABELS[c.status]],
        ["Assigned to", ctx.assigneeName(c.assigneeType, c.assigneeId) ?? "Unassigned"],
        ["Location", location ?? "-"],
        ["Due", c.dueDate ? day.format(c.dueDate) : "-"],
        ["Created", `${fmt.format(c.createdAt)} by ${c.createdBy?.name ?? "former member"}`],
        ["Completed", c.completedAt ? `${fmt.format(c.completedAt)} by ${c.completedBy?.name ?? "former member"}` : "Not completed"],
      ],
      summary: `${p.answered} of ${p.total} items answered${p.failed ? `, ${p.failed} failed` : ""}.`,
      sections: [],
    };
    for (const s of c.sections) {
      const out: ChecklistReport["sections"][number] = { title: s.title, items: [] };
      for (const i of s.items) {
        const photos: Uint8Array[] = [];
        for (const ph of i.photos.slice(0, MAX_PHOTOS_PER_ITEM)) {
          try {
            photos.push(await storage.read(ph.thumbKey));
          } catch (e) {
            console.error("checklists: couldn't read photo", ph.id, e);
          }
        }
        const sig = i.kind === "SIGNATURE" && i.value ? Buffer.from(i.value.slice(i.value.indexOf(",") + 1), "base64") : null;
        out.items.push({
          label: i.label,
          required: i.required,
          answer: answerText({ ...i, photoCount: i.photos.length }),
          failed: isFailed(i),
          meta: i.answeredAt ? `${i.answeredBy?.name ?? "Former member"}, ${fmt.format(i.answeredAt)}` : undefined,
          note: i.note,
          issue: i.issue ? `${issueLabel(i.issue.number)} (${i.issue.status.name})` : null,
          signature: sig,
          photos,
        });
      }
      report.sections.push(out);
    }
    const pdf = await buildChecklistPdf(report);
    await db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "checklist.exported", details: { checklistId: c.id, number: c.number } } });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(`${checklistLabel(c.number)} - ${c.title}.pdf`),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("checklists: export failed", e);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
