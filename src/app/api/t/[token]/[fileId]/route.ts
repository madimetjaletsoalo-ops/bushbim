import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { resolveLink } from "@/modules/transmittals/server";

/**
 * No-login download through a transmittal link. The signed link is the credential:
 * it must be genuine, unexpired and not revoked. Each download is written to the
 * transmittal log (and to the activity log when the recipient is a project member).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; fileId: string }> }) {
  const { token, fileId } = await params;
  const link = await resolveLink(token);
  if (!link) return NextResponse.json({ error: "Link not found" }, { status: 404 });
  if (link.state !== "active")
    return NextResponse.json({ error: link.state === "expired" ? "This link has expired" : "This link was revoked" }, { status: 410 });
  const { recipient, transmittal } = link;
  const doc = transmittal.documents.find((d) => d.id === fileId);
  if (!doc) return NextResponse.json({ error: "File not found" }, { status: 404 });
  if (!doc.version) return NextResponse.json({ error: "This file has been removed from the project" }, { status: 410 });

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.transmittalDownload.create({ data: { transmittalId: transmittal.id, recipientId: recipient.id, documentId: doc.id, createdAt: now } });
    await tx.transmittalRecipient.updateMany({ where: { id: recipient.id, firstOpenedAt: null }, data: { firstOpenedAt: now } });
    if (recipient.userId)
      await tx.auditEvent.create({
        data: {
          actorId: recipient.userId,
          projectId: transmittal.projectId,
          action: "transmittal.downloaded",
          details: { transmittalId: transmittal.id, number: transmittal.number, file: doc.fileName, version: doc.versionNumber },
        },
      });
  });
  const url = await getStorage().presignGet(doc.version.storageKey, doc.fileName, doc.version.contentType);
  return new NextResponse(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
}
