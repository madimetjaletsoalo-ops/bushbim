import { NextResponse, type NextRequest } from "next/server";
import { getStorage, readLocal, writeLocal } from "@/lib/storage";
import { contentDisposition } from "@/modules/docs/logic";
import { secretBytes, transferClaims, verifyToken } from "@/modules/docs/token";

// Local-disk stand-in for presigned S3 URLs. Only active when S3_BUCKET is unset.
// Access is granted solely by the short-lived signed token in ?t=, which the
// server issues after its own permission checks.

async function claims(req: NextRequest, op: "put" | "get") {
  if (getStorage().kind !== "local") return null;
  const t = req.nextUrl.searchParams.get("t");
  const c = t ? await verifyToken(t, transferClaims, secretBytes()) : null;
  return c && c.op === op ? c : null;
}

export async function PUT(req: NextRequest) {
  const c = await claims(req, "put");
  if (!c) return NextResponse.json({ error: "Invalid or expired upload link" }, { status: 403 });
  if (!req.body) return NextResponse.json({ error: "Empty body" }, { status: 400 });
  try {
    const size = await writeLocal(c.key, req.body, c.max ?? 0);
    return NextResponse.json({ ok: true, size });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 413 });
  }
}

export async function GET(req: NextRequest) {
  const c = await claims(req, "get");
  if (!c) return NextResponse.json({ error: "Invalid or expired download link" }, { status: 403 });
  const size = await getStorage().head(c.key);
  if (size === null) return NextResponse.json({ error: "File not found" }, { status: 404 });
  return new NextResponse(readLocal(c.key), {
    headers: {
      "Content-Type": c.ct || "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": c.inline ? "inline" : contentDisposition(c.fn || "download"),
      "Cache-Control": "private, no-store",
    },
  });
}
