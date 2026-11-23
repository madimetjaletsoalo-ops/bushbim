import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/CopyButton";
import { ConfirmButton } from "@/components/docs/ConfirmButton";
import { badge, btnDanger, card, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { getDocsContext } from "@/modules/docs/access";
import { levelAtLeast } from "@/modules/docs/folder-permissions";
import { formatBytes, versionLabel } from "@/modules/docs/logic";
import { revokeTransmittal } from "@/modules/transmittals/actions";
import { LINK_STATE_BADGE, LINK_STATE_LABEL, linkState, transmittalLabel } from "@/modules/transmittals/logic";
import { canSeeTransmittal, linkPath, ownsTransmittal } from "@/modules/transmittals/server";

export default async function TransmittalPage({ params }: { params: Promise<{ projectId: string; transmittalId: string }> }) {
  const { projectId, transmittalId } = await params;
  const ctx = await getDocsContext(projectId);
  const t = await db.transmittal.findFirst({
    where: { id: transmittalId, projectId },
    include: {
      sender: { select: { name: true } },
      documents: { include: { version: { select: { id: true, document: { select: { folderId: true } } } } } },
      recipients: { orderBy: { email: "asc" }, include: { _count: { select: { downloads: true } } } },
      downloads: { orderBy: { createdAt: "desc" }, take: 500, include: { recipient: { select: { email: true, name: true } }, document: { select: { fileName: true, versionNumber: true } } } },
    },
  });
  if (!t || !canSeeTransmittal(ctx, t)) notFound();
  const owner = ownsTransmittal(ctx, t);
  const state = linkState(t);
  // a member recipient sees only their own link
  const recipients = owner ? t.recipients : t.recipients.filter((r) => r.userId === ctx.user.id);
  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.project.timezone });
  const base = `/projects/${projectId}`;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link href={`${base}/transmittals`} className="text-sm text-ink-soft hover:underline">← Transmittals</Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold break-words">
            <span className="text-ink-soft">{transmittalLabel(t.number)}</span> {t.subject}
          </h2>
          {owner && state === "active" && (
            <form action={revokeTransmittal.bind(null, projectId, t.id)}>
              <ConfirmButton className={`${btnDanger} py-2`} message="Revoke every link in this transmittal? Recipients won't be able to download any more.">Revoke links</ConfirmButton>
            </form>
          )}
        </div>
        <p className="text-sm text-ink-soft" data-testid="transmittal-status">
          <span className={`${badge} ${LINK_STATE_BADGE[state]}`}>{LINK_STATE_LABEL[state]}</span>{" "}
          {state === "revoked" && t.revokedAt ? `revoked ${fmt.format(t.revokedAt)}` : `${state === "expired" ? "expired" : "until"} ${fmt.format(t.expiresAt)}`}
          {" · "}sent by {t.sender?.name ?? "former member"} {fmt.format(t.createdAt)}
        </p>
        {t.message && <p className="whitespace-pre-wrap rounded-md bg-muted/60 px-3 py-2 text-sm">{t.message}</p>}
      </div>

      <section className={`${card} overflow-x-auto`}>
        <h3 className="border-b border-line px-4 py-3 font-semibold">Files</h3>
        <ul className="divide-y divide-line" data-testid="transmittal-files">
          {t.documents.map((d) => {
            const open = d.version && levelAtLeast(ctx.levelOn(d.version.document.folderId), "VIEW");
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="min-w-0 break-all">
                  {d.fileName} <span className="text-ink-soft">{versionLabel(d.versionNumber)} · {formatBytes(d.size)}</span>
                </span>
                {!d.version ? (
                  <span className="text-xs text-ink-soft">Deleted from the project</span>
                ) : (
                  open && <Link className="text-xs text-brand hover:underline" href={`${base}/docs/folders/${d.version.document.folderId}`}>Open folder</Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className={`${card} overflow-x-auto`}>
        <h3 className="border-b border-line px-4 py-3 font-semibold">{owner ? "Recipients" : "Your link"}</h3>
        <table className="w-full" data-testid="recipients-table">
          <thead className="border-b border-line bg-muted/50">
            <tr>
              <th className={th}>Recipient</th>
              <th className={`${th} hidden sm:table-cell`}>Opened</th>
              <th className={th}>Downloads</th>
              <th className={th}><span className="sr-only">Link</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {recipients.map((r) => (
              <tr key={r.id} data-testid="recipient-row">
                <td className={td}>
                  <span className="break-all">{r.name ?? r.email}</span>
                  {r.name && <span className="block break-all text-xs text-ink-soft">{r.email}</span>}
                  {!r.userId && <span className="block text-xs text-ink-soft">External</span>}
                </td>
                <td className={`${td} hidden whitespace-nowrap sm:table-cell`}>{r.firstOpenedAt ? fmt.format(r.firstOpenedAt) : <span className="text-ink-soft">Not yet</span>}</td>
                <td className={td}>{r._count.downloads}</td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  {state === "active" ? <CopyButton path={linkPath(r.id)} label="Copy link" /> : <span className="text-xs text-ink-soft">{LINK_STATE_LABEL[state]}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={`${card} overflow-x-auto`}>
        <h3 className="border-b border-line px-4 py-3 font-semibold">Download log</h3>
        {(() => {
          const rows = owner ? t.downloads : t.downloads.filter((d) => recipients.some((r) => r.email === d.recipient.email));
          return rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-soft">No downloads yet.</p>
          ) : (
            <table className="w-full" data-testid="download-log">
              <thead className="border-b border-line bg-muted/50">
                <tr>
                  <th className={th}>When</th>
                  <th className={th}>Who</th>
                  <th className={th}>File</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((d) => (
                  <tr key={d.id} data-testid="download-row">
                    <td className={`${td} whitespace-nowrap`}>{fmt.format(d.createdAt)}</td>
                    <td className={`${td} break-all`}>{d.recipient.name ?? d.recipient.email}</td>
                    <td className={`${td} break-all`}>{d.document.fileName} <span className="text-ink-soft">{versionLabel(d.document.versionNumber)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}
      </section>
    </div>
  );
}
