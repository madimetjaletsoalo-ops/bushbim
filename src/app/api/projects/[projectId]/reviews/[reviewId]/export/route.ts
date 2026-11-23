import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { exportWithMarkups } from "@/modules/docs/export";
import { levelAtLeast } from "@/modules/docs/folder-permissions";
import { contentDisposition, versionLabel } from "@/modules/docs/logic";
import { isViewable, type Pt } from "@/modules/docs/markup";
import { buildReviewExport, type ReviewSummary } from "@/modules/reviews/export";
import { labelFor, parseStatuses, type Outcome } from "@/modules/reviews/logic";
import { reviewAccess } from "@/modules/reviews/server";

/**
 * ⭐ PDF of a closed review: summary of outcomes and comments, then each file with its
 * published markups flattened. Files are included only where the user has View + Download.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string; reviewId: string }> }) {
  const { projectId, reviewId } = await params;
  const ctx = await reviewAccess(projectId, reviewId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { review, steps } = ctx;
  if (review.status !== "CLOSED") return NextResponse.json({ error: "Only closed reviews can be exported" }, { status: 409 });
  const statuses = parseStatuses(review.workflow.statuses);
  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.project.timezone });
  const label = (o: string | null) => (o ? labelFor(statuses, o as Outcome) : "No outcome");
  const docName = new Map(review.documents.map((d) => [d.id, `${d.version.document.name} ${versionLabel(d.version.number)}`]));

  try {
    const storage = getStorage();
    const pdfs: Uint8Array[] = [];
    const files: ReviewSummary["files"] = [];
    let included = 0;
    for (const d of review.documents) {
      const v = d.version;
      const name = docName.get(d.id)!;
      if (!levelAtLeast(ctx.levelOn(v.document.folderId), "VIEW_DOWNLOAD")) {
        files.push({ name, outcome: label(d.outcome), note: "Pages not included: you don't have download access to this folder." });
        continue;
      }
      if (!isViewable(v.contentType, v.fileName)) {
        files.push({ name, outcome: label(d.outcome), note: "Pages not included: only PDFs and images can be exported." });
        continue;
      }
      const [markups, scales] = await Promise.all([
        db.markup.findMany({ where: { versionId: v.id, status: "PUBLISHED" } }),
        db.sheetCalibration.findMany({ where: { versionId: v.id } }),
      ]);
      try {
        pdfs.push(
          await exportWithMarkups(
            await storage.read(v.storageKey),
            v.contentType,
            v.fileName,
            markups.map((m) => ({ page: m.page, type: m.type, points: m.points as Pt[], color: m.color, text: m.text })),
            scales,
          ),
        );
        included++;
        files.push({ name, outcome: label(d.outcome), note: markups.length ? `${markups.length} published markup${markups.length === 1 ? "" : "s"}` : undefined });
      } catch (e) {
        console.error("reviews: couldn't export", v.fileName, e);
        files.push({ name, outcome: label(d.outcome), note: "Pages not included: the file couldn't be read." });
      }
    }
    const summary: ReviewSummary = {
      title: `Review #${review.number}: ${review.name}`,
      lines: [
        ["Project", ctx.project.name],
        ["Workflow", review.workflow.name],
        ["Started", `${fmt.format(review.createdAt)} by ${review.initiator?.name ?? "former member"}`],
        ["Closed", review.closedAt ? fmt.format(review.closedAt) : "-"],
      ],
      files,
      steps: steps.map((s) => {
        const ds = review.decisions.filter((d) => d.step === s.order);
        const reviewers = [...new Set(ds.map((d) => d.reviewerId))];
        return {
          title: `Step ${s.order}: ${s.name}`,
          decisions: reviewers.map((rid) => {
            const list = ds.filter((d) => d.reviewerId === rid);
            return {
              reviewer: list[0].reviewer.name,
              when: fmt.format(list[list.length - 1].updatedAt),
              items: list.map((d) => ({ file: docName.get(d.reviewDocumentId) ?? "", outcome: label(d.outcome), comment: d.comment })),
            };
          }),
        };
      }),
    };
    const out = await buildReviewExport(summary, pdfs);
    await db.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "review.exported", details: { reviewId, number: review.number, files: included } },
    });
    return new NextResponse(Buffer.from(out), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(`Review ${review.number} - ${review.name}.pdf`),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("reviews: export failed", e);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
