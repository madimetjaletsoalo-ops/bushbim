"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import type { ActionState } from "@/modules/admin/types";
import { getDocsContext } from "@/modules/docs/access";
import { levelAtLeast } from "@/modules/docs/folder-permissions";
import { MAX_RECIPIENTS, expiryFrom, mergeRecipients, parseEmails, sendSchema, transmittalLabel } from "./logic";
import { canSend, createTransmittal, ownsTransmittal } from "./server";

// See server.ts for the access rules. Every mutation writes an AuditEvent.

const fail = (error: string): ActionState => ({ ok: false, error });
const strings = (form: FormData, key: string) => [...new Set(form.getAll(key).filter((x): x is string => typeof x === "string" && !!x))];

export async function sendTransmittal(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getDocsContext(projectId);
  if (!canSend(ctx)) return fail("Sending transmittals needs Document Control Creator access.");
  const parsed = sendSchema.safeParse({
    subject: form.get("subject") ?? "",
    message: form.get("message") ?? "",
    expiryDays: form.get("expiryDays") ?? "",
    versionIds: strings(form, "versionIds"),
    memberIds: strings(form, "memberIds"),
    external: form.get("external") ?? "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { subject, message, expiryDays, versionIds, memberIds, external } = parsed.data;

  const { emails, invalid } = parseEmails(external);
  if (invalid.length) return fail(`Not a valid email address: ${invalid.slice(0, 3).join(", ")}`);

  const versions = await db.documentVersion.findMany({
    where: { id: { in: versionIds }, document: { projectId } },
    include: { document: { select: { name: true, folderId: true } } },
  });
  if (versions.length !== versionIds.length || versions.some((v) => !levelAtLeast(ctx.levelOn(v.document.folderId), "VIEW_DOWNLOAD")))
    return fail("You need View + Download on every file you send.");

  const members = await db.projectMember.findMany({ where: { projectId }, include: { user: { select: { id: true, email: true, name: true } } } });
  const byId = new Map(members.map((m) => [m.userId, m.user]));
  const chosen = memberIds.map((id) => byId.get(id));
  if (chosen.some((u) => !u)) return fail("A recipient isn't a member of this project.");
  const recipients = mergeRecipients(
    chosen.map((u) => ({ userId: u!.id, email: u!.email, name: u!.name })),
    emails,
    new Map(members.map((m) => [m.user.email.toLowerCase(), { userId: m.userId, name: m.user.name }])),
  );
  if (recipients.length === 0) return fail("Choose at least one member or enter an email address.");
  if (recipients.length > MAX_RECIPIENTS) return fail(`A transmittal can go to up to ${MAX_RECIPIENTS} recipients.`);

  const t = await createTransmittal({
    projectId,
    senderId: ctx.user.id,
    subject,
    message: message || null,
    expiresAt: expiryFrom(new Date(), expiryDays),
    // keep the order the files were listed in
    versions: versionIds.map((id) => versions.find((v) => v.id === id)!).map((v) => ({ id: v.id, fileName: v.document.name, number: v.number, size: v.size })),
    recipients,
  });
  revalidatePath(`/projects/${projectId}/transmittals`, "layout");
  redirect(`/projects/${projectId}/transmittals/${t.id}`);
}

const idSchema = z.string().min(1).max(64);

/** Stops every link of a transmittal working at once. */
export async function revokeTransmittal(projectId: string, transmittalId: string) {
  if (!idSchema.safeParse(transmittalId).success) return;
  const ctx = await getDocsContext(projectId);
  const t = await db.transmittal.findFirst({ where: { id: transmittalId, projectId } });
  if (!t || t.revokedAt || !ownsTransmittal(ctx, t)) return;
  await db.$transaction(async (tx) => {
    const r = await tx.transmittal.updateMany({ where: { id: t.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count)
      await tx.auditEvent.create({
        data: { actorId: ctx.user.id, projectId, action: "transmittal.revoked", details: { transmittalId, number: t.number, label: transmittalLabel(t.number) } },
      });
  });
  revalidatePath(`/projects/${projectId}/transmittals`, "layout");
}
