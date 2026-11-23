import "server-only";
import { db } from "@/lib/db";
import { can, type Grant, type MemberContext } from "@/lib/permissions";
import { secretBytes } from "@/modules/docs/token";
import { linkState, linkToken, verifyLinkToken } from "./logic";

// Access rules:
// - send: Document Control Creator, with View + Download on every file's folder
//   (a transmittal hands the file to people outside the app, so it counts as a download)
// - see a transmittal and its log: its sender, project admins, Document Control Managers,
//   and members it was sent to (who see only their own link)
// - revoke: its sender or a project admin / Document Control Manager

type Ctx = { user: { id: string }; member: MemberContext; grants: Grant[]; isAdmin: boolean };

export const canSend = (ctx: Ctx) => can(ctx.member, "DOCS", "create", ctx.grants);
export const managesTransmittals = (ctx: Ctx) => ctx.isAdmin || can(ctx.member, "DOCS", "manage", ctx.grants);

export function canSeeTransmittal(ctx: Ctx, t: { senderId: string | null; recipients: { userId: string | null }[] }) {
  if (!can(ctx.member, "DOCS", "view", ctx.grants)) return false;
  return managesTransmittals(ctx) || t.senderId === ctx.user.id || t.recipients.some((r) => r.userId === ctx.user.id);
}

/** Sender, or a manager: may see every recipient's link and revoke. */
export const ownsTransmittal = (ctx: Ctx, t: { senderId: string | null }) =>
  can(ctx.member, "DOCS", "view", ctx.grants) && (managesTransmittals(ctx) || t.senderId === ctx.user.id);

export const linkPath = (recipientId: string) => `/t/${linkToken(recipientId, secretBytes())}`;

/** Creates a transmittal with the next per-project number, retrying if two are sent at once. */
export async function createTransmittal(input: {
  projectId: string;
  senderId: string;
  subject: string;
  message: string | null;
  expiresAt: Date;
  versions: { id: string; fileName: string; number: number; size: number }[];
  recipients: { email: string; userId: string | null; name: string | null }[];
}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const last = await tx.transmittal.findFirst({ where: { projectId: input.projectId }, orderBy: { number: "desc" }, select: { number: true } });
        const number = (last?.number ?? 0) + 1;
        const t = await tx.transmittal.create({
          data: {
            projectId: input.projectId,
            number,
            subject: input.subject,
            message: input.message,
            senderId: input.senderId,
            expiresAt: input.expiresAt,
            documents: { create: input.versions.map((v) => ({ versionId: v.id, fileName: v.fileName, versionNumber: v.number, size: v.size })) },
            recipients: { create: input.recipients },
          },
        });
        await tx.auditEvent.create({
          data: {
            actorId: input.senderId,
            projectId: input.projectId,
            action: "transmittal.sent",
            details: {
              transmittalId: t.id,
              number,
              subject: input.subject,
              files: input.versions.length,
              recipients: input.recipients.map((r) => r.email),
              expiresAt: input.expiresAt.toISOString(),
            },
          },
        });
        return t;
      });
    } catch (e) {
      const unique = typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
      if (!unique || attempt >= 2) throw e;
    }
  }
}

/**
 * Resolves a public link token to its recipient and transmittal. Returns null for a forged
 * token or unknown recipient; the caller checks `state` for expiry and revocation.
 */
export async function resolveLink(token: string) {
  let recipientId: string | null;
  try {
    recipientId = verifyLinkToken(decodeURIComponent(token), secretBytes());
  } catch {
    return null;
  }
  if (!recipientId) return null;
  const recipient = await db.transmittalRecipient.findUnique({
    where: { id: recipientId },
    include: {
      transmittal: {
        include: {
          project: { select: { name: true, timezone: true } },
          sender: { select: { name: true } },
          documents: { orderBy: { fileName: "asc" }, include: { version: { select: { id: true, storageKey: true, fileName: true, contentType: true } } } },
        },
      },
    },
  });
  if (!recipient) return null;
  return { recipient, transmittal: recipient.transmittal, state: linkState(recipient.transmittal) };
}
