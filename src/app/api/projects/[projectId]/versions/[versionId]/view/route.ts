import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { folderAccess, getDocsContext } from "@/modules/docs/access";

/** File bytes for the in-browser viewer: needs View on the folder; redirects to a short-lived inline URL. */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) {
  const { projectId, versionId } = await params;
  await getDocsContext(projectId);
  const v = await db.documentVersion.findFirst({ where: { id: versionId, document: { projectId } }, include: { document: { select: { folderId: true } } } });
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await folderAccess(projectId, v.document.folderId, "VIEW"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = await getStorage().presignGet(v.storageKey, v.fileName, v.contentType, true);
  return new NextResponse(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
}
