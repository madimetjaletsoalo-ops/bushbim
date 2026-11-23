import Link from "next/link";
import { badge, btn, btnGhost, card, input, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { getDocsContext } from "@/modules/docs/access";
import { LINK_STATE_BADGE, LINK_STATE_LABEL, linkState, matchesSearch, searchTerms, transmittalLabel } from "@/modules/transmittals/logic";
import { canSeeTransmittal, canSend, managesTransmittals } from "@/modules/transmittals/server";

export default async function TransmittalLogPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { projectId } = await params;
  const ctx = await getDocsContext(projectId);
  const q = ((await searchParams).q ?? "").slice(0, 200);
  const terms = searchTerms(q);

  const rows = await db.transmittal.findMany({
    // managers see everything; others only what they sent or received
    where: managesTransmittals(ctx) ? { projectId } : { projectId, OR: [{ senderId: ctx.user.id }, { recipients: { some: { userId: ctx.user.id } } }] },
    include: {
      sender: { select: { name: true } },
      documents: { select: { fileName: true } },
      recipients: { select: { userId: true, email: true, name: true } },
      _count: { select: { downloads: true } },
    },
    orderBy: { number: "desc" },
    take: 500,
  });
  const list = rows
    .filter((t) => canSeeTransmittal(ctx, t))
    // ⭐ text search across subject, message, files, sender and recipients
    .filter((t) =>
      matchesSearch(terms, t.number, [t.subject, t.message, t.sender?.name, ...t.documents.map((d) => d.fileName), ...t.recipients.flatMap((r) => [r.email, r.name])]),
    );

  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: ctx.project.timezone });
  const base = `/projects/${projectId}/transmittals`;
  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Transmittals</h2>
        {canSend(ctx) && <Link href={`${base}/new`} className={btn}>New transmittal</Link>}
      </div>
      <form className="flex w-full gap-2 sm:max-w-md" role="search" action={base}>
        <input className={input} type="search" name="q" defaultValue={q} aria-label="Search transmittals" placeholder="Search subject, file, recipient or T-number" />
        <button className={btnGhost} type="submit">Search</button>
      </form>

      {list.length === 0 ? (
        <div className={`${card} p-8 text-center text-sm text-ink-soft`}>
          {terms.length ? "No transmittals match your search." : "No transmittals yet. Send document versions to members or anyone by email."}
        </div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full" data-testid="transmittals-table">
            <thead className="border-b border-line bg-muted/50">
              <tr>
                <th className={`${th} w-16`}>ID</th>
                <th className={th}>Subject</th>
                <th className={th}>Link</th>
                <th className={`${th} hidden sm:table-cell`}>To</th>
                <th className={`${th} hidden md:table-cell`}>Files</th>
                <th className={`${th} hidden md:table-cell`}>Downloads</th>
                <th className={`${th} hidden lg:table-cell`}>Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((t) => {
                const state = linkState(t, now);
                const to = t.recipients.map((r) => r.name ?? r.email);
                return (
                  <tr key={t.id} data-testid="transmittal-row">
                    <td className={`${td} whitespace-nowrap text-ink-soft`}>{transmittalLabel(t.number)}</td>
                    <td className={td}>
                      <Link href={`${base}/${t.id}`} className="font-medium break-words hover:underline">{t.subject}</Link>
                      <p className="mt-1 text-xs text-ink-soft sm:hidden">To {to.slice(0, 2).join(", ")}{to.length > 2 ? ` +${to.length - 2}` : ""}</p>
                    </td>
                    <td className={td}>
                      <span className={`${badge} ${LINK_STATE_BADGE[state]}`}>{LINK_STATE_LABEL[state]}</span>
                      {state === "active" && <span className="block text-xs text-ink-soft">until {fmt.format(t.expiresAt)}</span>}
                    </td>
                    <td className={`${td} hidden max-w-xs sm:table-cell`}>
                      <span className="break-words">{to.slice(0, 3).join(", ")}</span>
                      {to.length > 3 && <span className="text-ink-soft"> +{to.length - 3}</span>}
                    </td>
                    <td className={`${td} hidden md:table-cell`}>{t.documents.length}</td>
                    <td className={`${td} hidden md:table-cell`} data-testid="download-count">{t._count.downloads}</td>
                    <td className={`${td} hidden whitespace-nowrap lg:table-cell`}>
                      {fmt.format(t.createdAt)}
                      <span className="block text-xs text-ink-soft">{t.sender?.name ?? "Former member"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
