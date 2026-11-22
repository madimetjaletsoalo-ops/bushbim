import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { folderAccess, getDocsContext } from "@/modules/docs/access";
import { exportWithMarkups } from "@/modules/docs/export";
import { contentDisposition } from "@/modules/docs/logic";
import { isViewable, type Pt } from "@/modules/docs/markup";

/** PDF of a version with its published markups flattened in. Needs View + Download (it is a download). */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) {
  const { projectId, versionId } = await params;
  const ctx = await getDocsContext(projectId);
  const v = await db.documentVersion.findFirst({
    where: { id: versionId, document: { projectId } },
    include: { document: { select: { folderId: true } }, markups: { where: { status: "PUBLISHED" } }, calibrations: true },
  });
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await folderAccess(projectId, v.document.folderId, "VIEW_DOWNLOAD"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isViewable(v.contentType, v.fileName)) return NextResponse.json({ error: "Only PDFs and images can be exported" }, { status: 415 });
  try {
    const bytes = await getStorage().read(v.storageKey);
    const out = await exportWithMarkups(
      bytes,
      v.contentType,
      v.fileName,
      v.markups.map((m) => ({ page: m.page, type: m.type, points: m.points as Pt[], color: m.color, text: m.text })),
      v.calibrations,
    );
    await db.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "document.exported_with_markups", details: { versionId, name: v.fileName, markups: v.markups.length } },
    });
    const name = v.fileName.replace(/\.[^.]+$/, "") + ` (V${v.number} markups).pdf`;
    return new NextResponse(Buffer.from(out), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": contentDisposition(name), "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    console.error("docs: export failed", e);
    return NextResponse.json({ error: (e as Error).message || "Export failed" }, { status: 422 });
  }
}
