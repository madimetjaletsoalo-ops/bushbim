import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { card, input, label } from "@/components/ui";
import { db } from "@/lib/db";
import { getDocsContext } from "@/modules/docs/access";
import { levelAtLeast, pathUp } from "@/modules/docs/folder-permissions";
import { formatBytes, versionLabel } from "@/modules/docs/logic";
import { sendTransmittal } from "@/modules/transmittals/actions";
import { DEFAULT_EXPIRY_DAYS, MAX_EXPIRY_DAYS, MIN_EXPIRY_DAYS } from "@/modules/transmittals/logic";
import { canSend } from "@/modules/transmittals/server";

export default async function NewTransmittalPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ folderId?: string }> }) {
  const { projectId } = await params;
  const { folderId } = await searchParams;
  const ctx = await getDocsContext(projectId);

  if (!canSend(ctx))
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">New transmittal</h2>
        <div className={`${card} p-6 text-sm text-ink-soft`} data-testid="cannot-send">
          Sending transmittals needs Document Control Creator access. Ask a project admin.
        </div>
      </div>
    );

  // only folders the sender may download from
  const downloadable = ctx.folders.filter((f) => levelAtLeast(ctx.levelOn(f.id), "VIEW_DOWNLOAD")).map((f) => f.id);
  const inFolder = folderId && downloadable.includes(folderId) ? folderId : null;
  const [docs, members] = await Promise.all([
    db.document.findMany({
      where: { projectId, folderId: inFolder ? inFolder : { in: downloadable } },
      include: { versions: { orderBy: { number: "desc" }, take: 10, select: { id: true, number: true, size: true } } },
      orderBy: [{ folderId: "asc" }, { name: "asc" }],
      take: 300,
    }),
    db.projectMember.findMany({ where: { projectId, userId: { not: ctx.user.id } }, include: { user: { select: { id: true, name: true, email: true } }, company: { select: { name: true } } } }),
  ]);
  members.sort((a, b) => a.user.name.localeCompare(b.user.name));
  const folderPath = (id: string) =>
    pathUp(ctx.index, id)
      .reverse()
      .map((f) => ctx.index.byId.get(f)?.name)
      .join(" / ");
  const byFolder = new Map<string, typeof docs>();
  for (const d of docs) byFolder.set(d.folderId, [...(byFolder.get(d.folderId) ?? []), d]);
  const base = `/projects/${projectId}/transmittals`;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">New transmittal</h2>
      <ActionForm action={sendTransmittal.bind(null, projectId)} className={`${card} space-y-5 p-4`} testId="transmittal-form" resetOnSuccess={false}>
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <div>
            <label className={label} htmlFor="subject">Subject</label>
            <input className={input} id="subject" name="subject" required maxLength={200} placeholder="e.g. IFC drawings for the spa pavilion" />
          </div>
          <div>
            <label className={label} htmlFor="expiryDays">Links work for (days)</label>
            <input className={input} id="expiryDays" name="expiryDays" type="number" min={MIN_EXPIRY_DAYS} max={MAX_EXPIRY_DAYS} defaultValue={DEFAULT_EXPIRY_DAYS} required />
          </div>
        </div>
        <div>
          <label className={label} htmlFor="message">Message (optional)</label>
          <textarea className={input} id="message" name="message" rows={3} maxLength={4000} />
        </div>

        <fieldset>
          <legend className={label}>Files</legend>
          {inFolder && (
            <p className="mb-2 text-xs text-ink-soft">
              Showing {folderPath(inFolder)}. <Link className="text-brand hover:underline" href={`${base}/new`}>Show all folders</Link>
            </p>
          )}
          {docs.length === 0 ? (
            <p className="text-sm text-ink-soft">No files you can download here yet.</p>
          ) : (
            <div className="max-h-96 space-y-3 overflow-y-auto rounded-md border border-line p-3">
              {[...byFolder].map(([fid, list]) => (
                <div key={fid}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{folderPath(fid)}</p>
                  <ul className="mt-1 space-y-1">
                    {list.map((d) => {
                      const [latest, ...older] = d.versions;
                      if (!latest) return null;
                      return (
                        <li key={d.id} className="text-sm">
                          <label className="flex items-start gap-2">
                            <input type="checkbox" name="versionIds" value={latest.id} className="mt-0.5" aria-label={`Include ${d.name}`} />
                            <span className="break-all">
                              {d.name} <span className="text-ink-soft">{versionLabel(latest.number)} · {formatBytes(latest.size)}</span>
                            </span>
                          </label>
                          {older.length > 0 && (
                            <details className="ml-6 mt-1">
                              <summary className="cursor-pointer text-xs text-brand">Earlier versions</summary>
                              <ul className="mt-1 space-y-1">
                                {older.map((v) => (
                                  <li key={v.id}>
                                    <label className="flex items-center gap-2 text-xs">
                                      <input type="checkbox" name="versionIds" value={v.id} aria-label={`Include ${d.name} ${versionLabel(v.number)}`} />
                                      {versionLabel(v.number)} · {formatBytes(v.size)}
                                    </label>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend className={label}>Project members</legend>
          {members.length === 0 ? (
            <p className="text-sm text-ink-soft">No other members on this project.</p>
          ) : (
            <ul className="grid max-h-60 gap-1 overflow-y-auto rounded-md border border-line p-3 sm:grid-cols-2">
              {members.map((m) => (
                <li key={m.userId}>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="memberIds" value={m.userId} className="mt-0.5" aria-label={`Send to ${m.user.name}`} />
                    <span className="min-w-0 break-words">
                      {m.user.name}
                      {m.company && <span className="text-ink-soft"> · {m.company.name}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <div>
          <label className={label} htmlFor="external">External email addresses</label>
          <textarea className={input} id="external" name="external" rows={2} maxLength={10000} placeholder="consultant@example.com, supplier@example.com" />
          <p className="mt-1 text-xs text-ink-soft">
            Separate with commas or new lines. Each recipient gets their own download link that works without signing in, until it expires.
          </p>
        </div>
        <SubmitButton>Send transmittal</SubmitButton>
      </ActionForm>
    </div>
  );
}
