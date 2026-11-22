import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { folderAccess, getDocsContext } from "@/modules/docs/access";

/** Download one document version: needs View + Download on its folder, then redirects to a short-lived signed URL. */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) {
  const { projectId, versionId } = await params;
  await getDocsContext(projectId); // signed-in project member, or redirect / 404
  const v = await db.documentVersion.findFirst({ where: { id: versionId, document: { projectId } }, include: { document: { select: { folderId: true } } } });
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await folderAccess(projectId, v.document.folderId, "VIEW_DOWNLOAD"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = await getStorage().presignGet(v.storageKey, v.fileName, v.contentType);
  return new NextResponse(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
}
