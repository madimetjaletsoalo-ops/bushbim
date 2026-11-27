import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, btnGhost, card, input, label, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { sendTestMessage, savePreferences } from "@/modules/notifications/actions";
import { KIND_LABELS, maskPhone } from "@/modules/notifications/logic";
import { emailConfig, whatsappConfig } from "@/modules/notifications/server";

const STATUS_STYLE: Record<string, string> = {
  SENT: "bg-emerald-100 text-emerald-900",
  QUEUED: "bg-amber-100 text-amber-900",
  FAILED: "bg-red-100 text-red-900",
  SKIPPED: "bg-gray-100 text-gray-700",
};
const STATUS_LABEL: Record<string, string> = { SENT: "Sent", QUEUED: "Sending", FAILED: "Failed", SKIPPED: "Not sent" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const recent = await db.notification.findMany({
    where: { userId: user.id },
    include: { deliveries: { orderBy: { channel: "asc" } }, project: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });
  const waReady = !!whatsappConfig();
  const emailReady = !!emailConfig();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Get a message when an issue or checklist is assigned to you, or when an issue you watch changes status or gets a comment.
        </p>
      </div>

      <section className={`${card} p-5`}>
        <ActionForm action={savePreferences} resetOnSuccess={false} className="space-y-5" testId="notification-prefs">
          <fieldset className="space-y-2">
            <legend className="font-medium">Email</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="emailNotifications" defaultChecked={user.emailNotifications} className="mt-0.5" />
              <span>Email me at <strong>{user.email}</strong></span>
            </label>
            {!emailReady && <p className="text-xs text-ink-soft">Email sending isn&apos;t set up on this server yet, so messages are recorded but not sent.</p>}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="font-medium">WhatsApp</legend>
            <div className="max-w-xs">
              <label className={label} htmlFor="wa-number">WhatsApp number</label>
              <input
                className={input}
                id="wa-number"
                name="whatsappNumber"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="082 123 4567"
                defaultValue={user.whatsappNumber ?? ""}
                maxLength={40}
              />
              <p className="mt-1 text-xs text-ink-soft">Numbers without a country code are taken as South African (+27).</p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="whatsappOptIn" defaultChecked={user.whatsappOptIn} className="mt-0.5" data-testid="wa-opt-in" />
              <span>
                Yes, send my BushBIM notifications to this number on WhatsApp. I can turn this off here at any time, or reply STOP.
              </span>
            </label>
            {user.whatsappOptIn && user.whatsappOptInAt && (
              <p className="text-xs text-ink-soft" data-testid="wa-opted-in">
                WhatsApp on for {user.whatsappNumber ? maskPhone(user.whatsappNumber) : "your number"} since {fmt.format(user.whatsappOptInAt)}.
              </p>
            )}
            {!waReady && <p className="text-xs text-ink-soft">WhatsApp isn&apos;t set up on this server yet, so messages are recorded but not sent.</p>}
          </fieldset>
          <SubmitButton>Save preferences</SubmitButton>
        </ActionForm>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <ActionForm action={sendTestMessage.bind(null, "WHATSAPP")} testId="test-whatsapp">
            <SubmitButton className={btnGhost}>Send a WhatsApp test</SubmitButton>
          </ActionForm>
          <ActionForm action={sendTestMessage.bind(null, "EMAIL")} testId="test-email">
            <SubmitButton className={btnGhost}>Send a test email</SubmitButton>
          </ActionForm>
        </div>
      </section>

      <section className={card}>
        <h2 className="border-b border-line px-4 py-3 font-semibold">Recent messages</h2>
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-soft">No messages yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem]" data-testid="notification-log">
              <thead className="bg-muted">
                <tr><th className={th}>Message</th><th className={th}>When</th><th className={th}>Delivery</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recent.map((n) => (
                  <tr key={n.id} data-testid="notification-row">
                    <td className={td}>
                      <p className="text-xs text-ink-soft">{KIND_LABELS[n.kind] ?? n.kind}{n.project ? ` · ${n.project.name}` : ""}</p>
                      <p className="font-medium">{n.link ? <a href={n.link} className="hover:underline">{n.title}</a> : n.title}</p>
                      <p className="text-ink-soft">{n.body}</p>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{fmt.format(n.createdAt)}</td>
                    <td className={td}>
                      <ul className="space-y-1">
                        {n.deliveries.map((d) => (
                          <li key={d.id} className="whitespace-nowrap" data-testid={`delivery-${d.channel.toLowerCase()}`} data-status={d.status} title={d.error ?? undefined}>
                            <span className="mr-1 text-xs">{d.channel === "WHATSAPP" ? "WhatsApp" : "Email"}</span>
                            <span className={`${badge} ${STATUS_STYLE[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
