import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { incomingMessages, isStopMessage } from "@/modules/notifications/logic";

// WhatsApp Cloud API webhook. GET answers Meta's verification handshake (WHATSAPP_VERIFY_TOKEN);
// POST receives replies, signed with the app secret (WHATSAPP_APP_SECRET). A reply of STOP
// turns WhatsApp notifications off for that number.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === expected)
    return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  return new NextResponse("Forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 1_000_000 || !validSignature(raw, req.headers.get("x-hub-signature-256"))) return new NextResponse("Forbidden", { status: 403 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  for (const m of incomingMessages(payload)) {
    if (!isStopMessage(m.text)) continue;
    const users = await db.user.findMany({ where: { whatsappNumber: m.from, whatsappOptIn: true }, select: { id: true } });
    for (const u of users) {
      await db.$transaction([
        db.user.update({ where: { id: u.id }, data: { whatsappOptIn: false, whatsappOptInAt: null } }),
        db.auditEvent.create({ data: { actorId: u.id, action: "notifications.whatsapp_stopped", details: { via: "reply" } } }),
      ]);
    }
  }
  return NextResponse.json({ ok: true });
}
