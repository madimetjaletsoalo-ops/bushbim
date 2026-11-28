"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/modules/admin/types";
import { maskPhone, preferencesSchema, type Channel } from "./logic";
import { emailConfig, notify, whatsappConfig } from "./server";

// A user changes only their own preferences. Every change writes an AuditEvent.

const fail = (error: string): ActionState => ({ ok: false, error });

export async function savePreferences(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = preferencesSchema.safeParse({
    emailNotifications: form.get("emailNotifications") === "on",
    whatsappOptIn: form.get("whatsappOptIn") === "on",
    whatsappNumber: typeof form.get("whatsappNumber") === "string" ? (form.get("whatsappNumber") as string) : "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const v = parsed.data;
  const optingIn = v.whatsappOptIn && (!user.whatsappOptIn || user.whatsappNumber !== v.whatsappNumber);
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: {
        emailNotifications: v.emailNotifications,
        whatsappNumber: v.whatsappNumber,
        whatsappOptIn: v.whatsappOptIn,
        whatsappOptInAt: v.whatsappOptIn ? (optingIn ? new Date() : user.whatsappOptInAt) : null,
      },
    }),
    db.auditEvent.create({
      data: {
        actorId: user.id,
        action: "notifications.preferences_changed",
        details: { email: v.emailNotifications, whatsapp: v.whatsappOptIn, number: v.whatsappNumber ? maskPhone(v.whatsappNumber) : null },
      },
    }),
  ]);
  revalidatePath("/account/notifications");
  return { ok: true, message: v.whatsappOptIn ? "Saved. WhatsApp notifications are on." : "Saved." };
}

export async function sendTestMessage(channel: Channel): Promise<ActionState> {
  const user = await requireUser();
  if (channel !== "EMAIL" && channel !== "WHATSAPP") return fail("Unknown channel.");
  if (channel === "WHATSAPP") {
    if (!user.whatsappOptIn || !user.whatsappNumber) return fail("Turn on WhatsApp notifications and save your number first.");
    if (!whatsappConfig()) return fail("WhatsApp isn't set up on this server yet. Ask your administrator.");
  }
  if (channel === "EMAIL" && !emailConfig()) return fail("Email sending isn't set up on this server yet. Ask your administrator.");
  // at most one test a minute, so the button can't be used to spam a number
  const recent = await db.notification.findFirst({ where: { userId: user.id, kind: "test", createdAt: { gt: new Date(Date.now() - 60_000) }, deliveries: { some: { channel } } } });
  if (recent) return fail("A test was sent less than a minute ago. Check the list below.");
  await notify({
    projectId: null,
    actorId: user.id,
    userIds: [user.id],
    force: [channel],
    kind: "test",
    title: "Test message",
    body: `Hello ${user.name}, this is a test from BushBIM. Notifications will reach you here.`,
    link: "/account/notifications",
  });
  await db.auditEvent.create({ data: { actorId: user.id, action: "notifications.test_sent", details: { channel } } });
  revalidatePath("/account/notifications");
  return { ok: true, message: channel === "WHATSAPP" ? "Test sent to your WhatsApp." : "Test email sent." };
}
