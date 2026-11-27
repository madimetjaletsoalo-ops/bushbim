import "server-only";
import { after } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { channelsFor, messageText, parseWhatsappResponse, recipients, whatsappPayload, type Channel } from "./logic";

// Sends notifications by email and WhatsApp. Messages are recorded first (Notification +
// one NotificationDelivery per channel) and sent after the response, so a slow or failing
// provider never slows down or breaks the action that caused the message.

const SEND_TIMEOUT_MS = 8000;

export function whatsappConfig() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return null;
  return {
    token,
    phoneNumberId,
    base: (process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v21.0").replace(/\/$/, ""),
    template: process.env.WHATSAPP_TEMPLATE ? { name: process.env.WHATSAPP_TEMPLATE, language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en" } : null,
  };
}

export function emailConfig() {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return null;
  return { key, from, base: (process.env.RESEND_API_URL || "https://api.resend.com").replace(/\/$/, "") };
}

/** The app's public origin, for links in messages: APP_URL, else the request's host. */
export async function appOrigin(): Promise<string | null> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return null;
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

type Message = { title: string; body: string; url: string | null };

async function sendWhatsapp(to: string, m: Message): Promise<{ ok: true; id: string | null } | { ok: false; error: string; skipped?: boolean }> {
  const cfg = whatsappConfig();
  if (!cfg) return { ok: false, error: "WhatsApp isn't set up on this server.", skipped: true };
  const res = await fetch(`${cfg.base}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(whatsappPayload(to, m, cfg.template)),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    cache: "no-store",
  });
  return parseWhatsappResponse(res.status, await res.json().catch(() => null));
}

async function sendEmail(to: string, m: Message): Promise<{ ok: true; id: string | null } | { ok: false; error: string; skipped?: boolean }> {
  const cfg = emailConfig();
  if (!cfg) return { ok: false, error: "Email sending isn't set up on this server.", skipped: true };
  const res = await fetch(`${cfg.base}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: [to], subject: `BushBIM: ${m.title}`, text: messageText(m) }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
  return res.ok ? { ok: true, id: json?.id ?? null } : { ok: false, error: `Email: ${json?.message ?? `HTTP ${res.status}`}`.slice(0, 300) };
}

/** Sends one delivery and records the outcome. Never throws. */
export async function deliver(deliveryId: string, origin: string | null) {
  const d = await db.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { notification: { include: { user: { select: { email: true, whatsappNumber: true, whatsappOptIn: true, emailNotifications: true } } } } },
  });
  if (!d || d.status === "SENT") return;
  const { notification: n } = d;
  const m: Message = { title: n.title, body: n.body, url: n.link ? (origin ? `${origin}${n.link}` : n.link) : null };
  let r: Awaited<ReturnType<typeof sendEmail>>;
  try {
    if (d.channel === "WHATSAPP")
      r = n.user.whatsappOptIn && n.user.whatsappNumber ? await sendWhatsapp(n.user.whatsappNumber, m) : { ok: false, error: "The user turned WhatsApp off.", skipped: true };
    else r = n.user.emailNotifications || n.kind === "test" ? await sendEmail(n.user.email, m) : { ok: false, error: "The user turned email off.", skipped: true };
  } catch (e) {
    r = { ok: false, error: `${d.channel === "WHATSAPP" ? "WhatsApp" : "Email"}: ${(e as Error).message}`.slice(0, 300) };
  }
  await db.notificationDelivery.update({
    where: { id: d.id },
    data: r.ok
      ? { status: "SENT", providerId: r.id, error: null, sentAt: new Date(), attempts: { increment: 1 } }
      : { status: r.skipped ? "SKIPPED" : "FAILED", error: r.error, attempts: { increment: 1 } },
  });
}

/** Runs after the response when inside a request, straight away otherwise (scripts, tests). */
function later(task: () => Promise<unknown>) {
  const run = () => task().catch((e) => console.error("notifications: send failed", e));
  try {
    after(run);
  } catch {
    void run();
  }
}

export type NotifyInput = {
  projectId: string | null;
  actorId: string;
  userIds: (string | null | undefined)[];
  kind: string;
  title: string;
  body: string;
  link?: string | null;
  /** channels to use regardless of preferences (the "send a test" button) */
  force?: Channel[];
};

/**
 * Records a notification for each recipient (never the actor) on the channels they allow,
 * then sends them after the response. Returns the number of messages queued.
 */
export async function notify(input: NotifyInput): Promise<number> {
  const ids = input.force ? [...new Set(input.userIds.filter((x): x is string => !!x))] : recipients(input.userIds, input.actorId);
  if (!ids.length) return 0;
  try {
    const users = await db.user.findMany({
      // only people who are still on the project (a former watcher hears nothing more)
      where: { id: { in: ids }, passwordHash: { not: null }, ...(input.projectId ? { memberships: { some: { projectId: input.projectId } } } : {}) },
      select: { id: true, email: true, emailNotifications: true, whatsappOptIn: true, whatsappNumber: true },
    });
    const deliveryIds: string[] = [];
    for (const u of users) {
      const channels = input.force ?? channelsFor(u);
      if (!channels.length) continue;
      const n = await db.notification.create({
        data: {
          userId: u.id,
          projectId: input.projectId,
          kind: input.kind,
          title: input.title.slice(0, 200),
          body: input.body.slice(0, 1000),
          link: input.link ?? null,
          deliveries: { create: channels.map((channel) => ({ channel })) },
        },
        include: { deliveries: { select: { id: true } } },
      });
      deliveryIds.push(...n.deliveries.map((d) => d.id));
    }
    // read the host now: request headers aren't available once the response has gone
    const origin = deliveryIds.length ? await appOrigin() : null;
    if (deliveryIds.length) later(() => Promise.allSettled(deliveryIds.map((id) => deliver(id, origin))));
    return deliveryIds.length;
  } catch (e) {
    // a notification problem must never undo or fail the change that caused it
    console.error("notifications: could not record", e);
    return 0;
  }
}

/** Project members with their company and role ids, for expanding role/company assignees. */
export async function projectMembersForNotify(projectId: string) {
  const members = await db.projectMember.findMany({ where: { projectId }, include: { roles: { select: { roleId: true } } } });
  return members.map((m) => ({ userId: m.userId, companyId: m.companyId, roleIds: m.roles.map((r) => r.roleId) }));
}
