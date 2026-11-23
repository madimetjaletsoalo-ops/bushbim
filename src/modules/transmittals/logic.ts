// Pure transmittal logic: recipients, link tokens, link state and search.
// No database access, so it can be unit-tested.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const MAX_FILES_PER_TRANSMITTAL = 100;
export const MAX_RECIPIENTS = 50;
export const MIN_EXPIRY_DAYS = 1;
export const MAX_EXPIRY_DAYS = 30;
export const DEFAULT_EXPIRY_DAYS = 14;

export const transmittalLabel = (n: number) => `T-${n}`;

// ---------- recipients ----------

const emailSchema = z.string().email().max(254);

/**
 * Splits a free-text box of external addresses (commas, semicolons, spaces or new lines)
 * into lower-cased unique emails. "Name <a@b.co>" is accepted. Returns the invalid entries too.
 */
export function parseEmails(raw: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  // pull out "<addr>" forms first so the display name's spaces don't split the entry
  const parts = raw.replace(/[^,;\n<]*<([^>]*)>/g, " $1 ").split(/[\s,;]+/);
  for (const part of parts) {
    const e = part.trim().toLowerCase();
    if (!e) continue;
    if (!emailSchema.safeParse(e).success) {
      invalid.push(part.trim());
      continue;
    }
    if (!seen.has(e)) {
      seen.add(e);
      emails.push(e);
    }
  }
  return { emails, invalid };
}

export interface RecipientInput {
  email: string;
  userId: string | null;
  name: string | null;
}

/**
 * Merges chosen members with external emails. An external email that belongs to a chosen
 * member (or to any project member) is treated as that member, so each person appears once.
 */
export function mergeRecipients(
  members: { userId: string; email: string; name: string }[],
  external: string[],
  projectMembersByEmail: Map<string, { userId: string; name: string }>,
): RecipientInput[] {
  const out = new Map<string, RecipientInput>();
  for (const m of members) out.set(m.email.toLowerCase(), { email: m.email.toLowerCase(), userId: m.userId, name: m.name });
  for (const e of external) {
    if (out.has(e)) continue;
    const m = projectMembersByEmail.get(e);
    out.set(e, { email: e, userId: m?.userId ?? null, name: m?.name ?? null });
  }
  return [...out.values()];
}

// ---------- expiry and state ----------

export const expiryFrom = (from: Date, days: number) => new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

export type LinkState = "active" | "expired" | "revoked";

export function linkState(t: { expiresAt: Date; revokedAt: Date | null }, now: Date = new Date()): LinkState {
  if (t.revokedAt) return "revoked";
  return now.getTime() >= t.expiresAt.getTime() ? "expired" : "active";
}

export const LINK_STATE_LABEL: Record<LinkState, string> = { active: "Active", expired: "Expired", revoked: "Revoked" };
export const LINK_STATE_BADGE: Record<LinkState, string> = {
  active: "bg-emerald-100 text-emerald-900",
  expired: "bg-amber-100 text-amber-900",
  revoked: "bg-red-100 text-red-900",
};

// ---------- link tokens ----------
// A recipient's link is "<recipientId>.<mac>", where mac = HMAC-SHA256(secret, recipientId).
// Nothing secret is stored in the database, and the sender can copy the link again later.

const mac = (recipientId: string, secret: Uint8Array) =>
  createHmac("sha256", secret).update(`transmittal:${recipientId}`).digest("base64url").slice(0, 32);

export function linkToken(recipientId: string, secret: Uint8Array): string {
  return `${recipientId}.${mac(recipientId, secret)}`;
}

/** Returns the recipient id if the token is genuine, else null. */
export function verifyLinkToken(token: string, secret: Uint8Array): string | null {
  if (typeof token !== "string" || token.length > 140) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  if (!/^[\w-]{1,64}$/.test(id)) return null;
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(mac(id, secret));
  return given.length === want.length && timingSafeEqual(given, want) ? id : null;
}

// ---------- input ----------

export const sendSchema = z.object({
  subject: z.string().trim().min(1, "Give the transmittal a subject").max(200, "Subject must be 200 characters or fewer"),
  message: z.string().trim().max(4000, "Message must be 4000 characters or fewer"),
  expiryDays: z.coerce
    .number({ invalid_type_error: "Choose how long the links work" })
    .int()
    .min(MIN_EXPIRY_DAYS, `Links must work for at least ${MIN_EXPIRY_DAYS} day`)
    .max(MAX_EXPIRY_DAYS, `Links can work for at most ${MAX_EXPIRY_DAYS} days`),
  versionIds: z
    .array(z.string().min(1).max(64))
    .min(1, "Choose at least one file")
    .max(MAX_FILES_PER_TRANSMITTAL, `A transmittal can have up to ${MAX_FILES_PER_TRANSMITTAL} files`),
  memberIds: z.array(z.string().min(1).max(64)).max(MAX_RECIPIENTS),
  external: z.string().max(10_000),
});

// ---------- search ----------

/** Lower-cased search terms; "T-12", "#12" and "12" also match transmittal 12. */
export function searchTerms(q: string | undefined): string[] {
  return (q ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
}

/** True if every term is the transmittal's number or appears in one of its texts. */
export function matchesSearch(terms: string[], number: number, texts: (string | null | undefined)[]): boolean {
  const hay = texts.filter(Boolean).join("\n").toLowerCase();
  const ids = new Set([`t-${number}`, `#${number}`, String(number)]);
  return terms.every((t) => ids.has(t) || hay.includes(t));
}
