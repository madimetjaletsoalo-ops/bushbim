import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { btn, card } from "@/components/ui";
import { db } from "@/lib/db";
import { formatBytes, versionLabel } from "@/modules/docs/logic";
import { transmittalLabel } from "@/modules/transmittals/logic";
import { resolveLink } from "@/modules/transmittals/server";

export const metadata: Metadata = { title: "Transmittal · BushBIM", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The page a recipient lands on from their link. No sign-in needed. */
export default async function TransmittalLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveLink(token);
  if (!link) notFound();
  const { recipient, transmittal: t, state } = link;
  if (state === "active" && !recipient.firstOpenedAt)
    await db.transmittalRecipient.updateMany({ where: { id: recipient.id, firstOpenedAt: null }, data: { firstOpenedAt: new Date() } });
  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: t.project.timezone });

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 text-2xl text-ink"><Logo /></div>
      <div className={`${card} space-y-4 p-5 sm:p-6`}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{t.project.name} · Transmittal {transmittalLabel(t.number)}</p>
          <h1 className="mt-1 text-xl font-semibold break-words">{t.subject}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            From {t.sender?.name ?? "a former project member"} · sent {fmt.format(t.createdAt)} · to {recipient.name ? `${recipient.name} (${recipient.email})` : recipient.email}
          </p>
        </div>
        {state !== "active" ? (
          <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="link-state">
            {state === "expired" ? `This link expired on ${fmt.format(t.expiresAt)}.` : "The sender has revoked this link."} Ask the sender for a new transmittal.
          </p>
        ) : (
          <>
            {t.message && <p className="whitespace-pre-wrap rounded-md bg-muted/60 px-3 py-2 text-sm">{t.message}</p>}
            <p className="text-sm text-ink-soft" data-testid="link-state">Downloads work until {fmt.format(t.expiresAt)}.</p>
            <ul className="divide-y divide-line rounded-md border border-line" data-testid="link-files">
              {t.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 break-all text-sm">
                    {d.fileName} <span className="text-ink-soft">{versionLabel(d.versionNumber)} · {formatBytes(d.size)}</span>
                  </span>
                  {d.version ? (
                    <a className={btn} href={`/api/t/${encodeURIComponent(token)}/${d.id}`} aria-label={`Download ${d.fileName}`}>Download</a>
                  ) : (
                    <span className="text-xs text-ink-soft">No longer available</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <p className="mt-6 text-center text-xs text-ink-soft">Sent with BushBIM. Downloads are recorded in the project&apos;s transmittal log.</p>
    </main>
  );
}
