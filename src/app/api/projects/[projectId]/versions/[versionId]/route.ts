import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getStorage } from "@/lib/storage";

/** Download one document version: checks DOCS view access, then redirects to a short-lived signed URL. */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) {
  const { projectId, versionId } = await params;
  const { member, grants } = await getProjectContext(projectId);
  if (!can(member, "DOCS", "view", grants)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const v = await db.documentVersion.findFirst({ where: { id: versionId, document: { projectId } } });
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = await getStorage().presignGet(v.storageKey, v.fileName, v.contentType);
  return new NextResponse(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
}
