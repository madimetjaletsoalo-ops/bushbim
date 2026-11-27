"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { badge, btn, btnGhost, card } from "@/components/ui";
import { listEntries, onOutboxChange, removeEntry, type Entry } from "./outbox";
import { OfflinePhotoPicker } from "./OfflinePhotoPicker";
import { resendWithForce, syncOutbox } from "./sync";

const KIND: Record<Entry["kind"], string> = { "issue.create": "New issue", "checklist.answer": "Checklist answer", photo: "Photo" };

const shortValue = (v: string | null | undefined) => (!v ? "(blank)" : v.startsWith("data:image/") ? "(signature)" : v.length > 120 ? `${v.slice(0, 119)}…` : v);

/** Changes kept on this device: waiting ones, and synced ones with a conflict or notice to deal with. */
export function OfflineChanges({ projectId, userId }: { projectId: string; userId: string }) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => setEntries((await listEntries()).filter((e) => e.userId === userId && e.projectId === projectId)), [userId, projectId]);
  useEffect(() => {
    void load();
    return onOutboxChange(() => void load());
  }, [load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch {
      setError("That didn't work. Check your connection and try again.");
    } finally {
      setBusy(null);
      void load();
    }
  }

  function savePhoto(e: Entry) {
    if (!e.photo) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(e.photo);
    a.download = e.label.replace(/\.[^.]+$/, "") + ".jpg";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  if (!entries) return <p className="text-sm text-ink-soft">Loading…</p>;
  const pending = entries.filter((e) => e.state === "pending");
  const attention = entries.filter((e) => e.state !== "pending");

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <section className={card} data-testid="offline-attention-list">
        <h3 className="border-b border-line px-4 py-3 font-semibold">Needs your attention</h3>
        {attention.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-soft">Nothing to sort out.</p>
        ) : (
          <ul className="divide-y divide-line">
            {attention.map((e) => (
              <li key={e.clientId} className="space-y-2 px-4 py-3 text-sm" data-testid="offline-conflict" data-kind={e.kind}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={`${badge} ${e.state === "conflict" ? "bg-red-100 text-red-900" : "bg-amber-100 text-amber-900"}`}>{e.state === "conflict" ? "Not saved" : "Saved with changes"}</span>
                  <span className="text-ink-soft">{KIND[e.kind]}</span>
                  <span className="font-medium break-words">{e.label}</span>
                </div>
                <p data-testid="offline-conflict-message">{e.message}</p>
                {e.theirs && e.change.kind === "checklist.answer" && (
                  <dl className="grid gap-x-4 gap-y-1 rounded-md bg-muted p-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-ink-soft">Their answer{e.theirs.by ? ` (${e.theirs.by})` : ""}</dt>
                      <dd data-testid="theirs">{shortValue(e.theirs.value)}{e.theirs.note ? ` · ${e.theirs.note}` : ""}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-soft">Your offline answer</dt>
                      <dd data-testid="mine">{shortValue(e.change.value)}{e.change.note ? ` · ${e.change.note}` : ""}</dd>
                    </div>
                  </dl>
                )}
                <div className="flex flex-wrap gap-2">
                  {e.state === "conflict" && e.theirs && (
                    <button type="button" className={btn} disabled={busy === e.clientId} onClick={() => void act(e.clientId, () => resendWithForce(e))}>Use my answer</button>
                  )}
                  {e.state === "conflict" && e.kind === "photo" && e.photo && (
                    <button type="button" className={btnGhost} onClick={() => savePhoto(e)}>Save photo to this device</button>
                  )}
                  {e.resultHref && <Link href={e.resultHref} className={btnGhost}>Open issue</Link>}
                  {!e.resultHref && e.href && <Link href={e.href} className={btnGhost}>Open</Link>}
                  <button type="button" className={btnGhost} disabled={busy === e.clientId} onClick={() => void act(e.clientId, () => removeEntry(e.clientId))}>
                    {e.state === "notice" ? "OK" : e.theirs ? "Keep theirs" : "Discard"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card} data-testid="offline-pending-list">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h3 className="font-semibold">Waiting to sync</h3>
          {pending.length > 0 && (
            <button type="button" className={btnGhost} disabled={busy === "all"} onClick={() => void act("all", () => syncOutbox())}>Sync now</button>
          )}
        </div>
        {pending.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-soft">Everything made on this device has synced.</p>
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((e) => (
              <li key={e.clientId} className="space-y-2 px-4 py-3 text-sm" data-testid="offline-pending-item">
                <p>
                  <span className="text-ink-soft">{KIND[e.kind]} · </span>
                  <span className="font-medium break-words">{e.label}</span>
                  {e.change.kind === "checklist.answer" && <span className="text-ink-soft"> → {shortValue(e.change.value)}</span>}
                  <span className="text-xs text-ink-soft"> · {new Date(e.change.madeAt).toLocaleString("en-ZA")}</span>
                </p>
                {e.kind === "issue.create" && <OfflinePhotoPicker projectId={projectId} target={{ type: "offline-issue", issueClientId: e.clientId }} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
