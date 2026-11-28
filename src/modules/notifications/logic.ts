// Pure notification logic: phone numbers, WhatsApp Cloud API payloads, who gets
// a message and on which channel. No database access, so it is unit tested.
import { z } from "zod";

export const CHANNELS = ["EMAIL", "WHATSAPP"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Country code used when someone types a local number such as 082 123 4567. */
export const DEFAULT_COUNTRY_CODE = "27";

/**
 * Normalises a phone number to E.164 ("+27821234567").
 * Accepts "+27 82 123 4567", "0027821234567", "27821234567" and local "082 123 4567"
 * (local numbers get the default country code). Returns null when it can't be a mobile number.
 */
export function normalisePhone(raw: string, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/[^\d\s()+.-]/.test(trimmed)) return null;
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.indexOf("+") > 0 || (digits.match(/\+/g)?.length ?? 0) > 1) return null;
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = countryCode + digits.slice(1);
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  // a South African mobile number has 9 digits after the 27
  if (digits.startsWith("27") && digits.length !== 11) return null;
  return `+${digits}`;
}

/** "+27 82 *** 4567": shown in lists and logs without the whole number. */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return e164;
  return `${e164.slice(0, 3)} ${e164.slice(3, 5)} *** ${e164.slice(-4)}`;
}

export const preferencesSchema = z
  .object({
    emailNotifications: z.boolean(),
    whatsappOptIn: z.boolean(),
    whatsappNumber: z.string().max(40),
  })
  .transform((v, ctx) => {
    const number = v.whatsappNumber.trim() ? normalisePhone(v.whatsappNumber) : null;
    if (v.whatsappNumber.trim() && !number) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a mobile number such as 082 123 4567 or +27 82 123 4567." });
      return z.NEVER;
    }
    if (v.whatsappOptIn && !number) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Add your WhatsApp number to turn on WhatsApp notifications." });
      return z.NEVER;
    }
    return { emailNotifications: v.emailNotifications, whatsappOptIn: v.whatsappOptIn, whatsappNumber: number };
  });

export type Prefs = { email: string; emailNotifications: boolean; whatsappOptIn: boolean; whatsappNumber: string | null };

/** The channels a user receives a message on. WhatsApp needs an explicit opt-in and a number. */
export function channelsFor(p: Prefs): Channel[] {
  const out: Channel[] = [];
  if (p.emailNotifications && p.email) out.push("EMAIL");
  if (p.whatsappOptIn && p.whatsappNumber) out.push("WHATSAPP");
  return out;
}

/** Distinct recipients, never the person who made the change. */
export function recipients(userIds: (string | null | undefined)[], actorId: string): string[] {
  return [...new Set(userIds.filter((id): id is string => !!id && id !== actorId))];
}

/**
 * Users an assignment reaches: the user, every member of the role, or every member of the company.
 * `members` are the project's members with their company and roles.
 */
export function assigneeUserIds(
  assignee: { type: "USER" | "ROLE" | "COMPANY" | null; id: string | null },
  members: { userId: string; companyId: string | null; roleIds: string[] }[],
): string[] {
  if (!assignee.type || !assignee.id) return [];
  const id = assignee.id;
  if (assignee.type === "USER") return members.some((m) => m.userId === id) ? [id] : [];
  if (assignee.type === "ROLE") return members.filter((m) => m.roleIds.includes(id)).map((m) => m.userId);
  return members.filter((m) => m.companyId === id).map((m) => m.userId);
}

export const MAX_TITLE = 120;
export const MAX_BODY = 600;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Plain text of a message, as sent by WhatsApp when no template is configured, and as the email body. */
export function messageText(n: { title: string; body: string; url: string | null }): string {
  return [clip(n.title, MAX_TITLE), clip(n.body, MAX_BODY), n.url].filter(Boolean).join("\n\n");
}

/**
 * Request body for the WhatsApp Cloud API `/{phone-number-id}/messages` endpoint.
 * Business-initiated messages must use an approved template; the template is expected to have
 * three body variables: {{1}} title, {{2}} details, {{3}} link. Without a template a plain text
 * message is sent, which WhatsApp only delivers inside a 24-hour customer service window.
 */
export function whatsappPayload(
  to: string,
  n: { title: string; body: string; url: string | null },
  template?: { name: string; language: string } | null,
) {
  const recipient = to.replace(/^\+/, "");
  if (template?.name) {
    // template variables can't contain newlines, tabs or more than four spaces in a row
    const param = (s: string, max: number) => clip(s.replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim() || "-", max);
    return {
      messaging_product: "whatsapp",
      to: recipient,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language || "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: param(n.title, MAX_TITLE) },
              { type: "text", text: param(n.body, MAX_BODY) },
              { type: "text", text: param(n.url ?? "", 300) },
            ],
          },
        ],
      },
    };
  }
  return { messaging_product: "whatsapp", to: recipient, type: "text", text: { preview_url: false, body: messageText(n) } };
}

/** The message id from a Cloud API reply, or the error it reports. */
export function parseWhatsappResponse(status: number, json: unknown): { ok: true; id: string | null } | { ok: false; error: string } {
  const j = (json ?? {}) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } };
  if (status >= 200 && status < 300 && !j.error) return { ok: true, id: j.messages?.[0]?.id ?? null };
  const msg = j.error?.message ?? `HTTP ${status}`;
  return { ok: false, error: clip(`WhatsApp: ${msg}${j.error?.code ? ` (${j.error.code})` : ""}`, 300) };
}

/** Words that opt a user out when they reply to a WhatsApp message. */
const STOP_WORDS = new Set(["stop", "unsubscribe", "stop all", "opt out", "cancel"]);
export const isStopMessage = (text: string) => STOP_WORDS.has(text.trim().toLowerCase().replace(/[.!]+$/, ""));

/** Incoming text messages from a WhatsApp webhook payload: sender (E.164) and text. */
export function incomingMessages(payload: unknown): { from: string; text: string }[] {
  const out: { from: string; text: string }[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    const changes = (e as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      const messages = (c as { value?: { messages?: unknown[] } })?.value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        const msg = m as { from?: unknown; type?: unknown; text?: { body?: unknown }; button?: { text?: unknown } };
        const text = msg.type === "button" ? msg.button?.text : msg.text?.body;
        if (typeof msg.from === "string" && typeof text === "string" && /^\d{8,15}$/.test(msg.from)) out.push({ from: `+${msg.from}`, text });
      }
    }
  }
  return out;
}

export const KIND_LABELS: Record<string, string> = {
  "issue.assigned": "Issue assigned",
  "issue.status_changed": "Issue status",
  "issue.commented": "Issue comment",
  "checklist.assigned": "Checklist assigned",
  test: "Test message",
};
