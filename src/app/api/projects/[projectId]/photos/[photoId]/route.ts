import { NextResponse, type NextRequest } from "next/server";
import { getStorage } from "@/lib/storage";
import { photoAccess } from "@/modules/issues/media-server";
import { getIssuesContext } from "@/modules/issues/server";

/**
 * A photo (or its thumbnail with ?size=thumb) for anyone who may see it: the issue's
 * viewers, or for project photos anyone with Issues or Document Control access.
 * Redirects to a short-lived inline URL; ?download=1 saves the file instead.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string; photoId: string }> }) {
  const { projectId, photoId } = await params;
  const ctx = await getIssuesContext(projectId);
  const found = await photoAccess(ctx, photoId);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const thumb = req.nextUrl.searchParams.get("size") === "thumb";
  const download = req.nextUrl.searchParams.get("download") === "1";
  const { photo } = found;
  const url = await getStorage().presignGet(thumb ? photo.thumbKey : photo.storageKey, photo.fileName, "image/jpeg", !download);
  // the signed URL lives 15 minutes, so the browser may reuse this redirect for a few
  return new NextResponse(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=300" } });
}
