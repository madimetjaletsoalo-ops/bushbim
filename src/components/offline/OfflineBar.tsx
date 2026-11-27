"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { pendingText } from "@/modules/offline/logic";
import { listEntries, onOutboxChange, setOfflineUser, type Entry } from "./outbox";
import { clearOfflineCache, warmPages } from "./ServiceWorker";
import { syncOutbox } from "./sync";

const RETRY_MS = 60_000;
/** a page opened by in-app navigation is fetched again for offline use at most this often (seconds) */
const PAGE_REFRESH_S = 600;

/**
 * The offline strip under the project tabs: says when the device is offline, how many changes
 * are waiting, and when synced changes need attention. Syncs when the connection comes back.
 */
export function OfflineBar({ projectId, userId, warm }: { projectId: string; userId: string; warm: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [online, setOnline] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => setEntries((await listEntries()).filter((e) => e.userId === userId)), [userId]);

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    try {
      const r = await syncOutbox();
      if (r.applied > 0 || r.conflicts > 0) router.refresh();
    } finally {
      setSyncing(false);
      void load();
    }
  }, [load, router]);

  useEffect(() => {
    // another person used this device without signing out: drop the pages cached for them
    if (setOfflineUser(userId)) void clearOfflineCache();
    setOnline(navigator.onLine);
    void load();
    void sync();
    const up = () => {
      setOnline(true);
      void sync();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const off = onOutboxChange(() => void load());
    const timer = setInterval(() => void sync(), RETRY_MS);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      off();
      clearInterval(timer);
    };
  }, [userId, load, sync]);

  // keep the pages a site team needs offline, even if they haven't opened them yet
  const warmKey = warm.join("|");
  useEffect(() => {
    if (navigator.onLine && warmKey) void warmPages(warmKey.split("|"));
  }, [warmKey]);

  // pages opened with in-app links never reach the service worker as page loads, so ask it to keep
  // this one too (skipped on data-saver connections)
  useEffect(() => {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (!navigator.onLine || saveData) return;
    const t = setTimeout(() => void warmPages([`${pathname}${window.location.search}`], { maxAge: PAGE_REFRESH_S }), 500);
    return () => clearTimeout(t);
  }, [pathname]);

  const here = entries.filter((e) => e.projectId === projectId);
  const pending = here.filter((e) => e.state === "pending").length;
  const attention = here.filter((e) => e.state !== "pending").length;
  if (online && !pending && !attention) return null;

  const href = `/projects/${projectId}/offline`;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6 ${!online ? "bg-amber-100 text-amber-950" : attention ? "bg-red-50 text-red-900" : "bg-sky-50 text-sky-950"}`}
      role="status"
      data-testid="offline-bar"
      data-online={online}
    >
      {!online && <span className="font-medium">You&apos;re offline. Pages you opened recently still work; new issues, answers and photos are kept on this device.</span>}
      {pending > 0 && (
        <span data-testid="offline-pending">
          {syncing && online ? "Syncing… " : ""}
          {pendingText(pending)}
        </span>
      )}
      {attention > 0 && (
        <Link href={href} className="font-medium underline" data-testid="offline-attention">
          {attention === 1 ? "1 offline change needs your attention" : `${attention} offline changes need your attention`}
        </Link>
      )}
      {(pending > 0 || attention > 0) && attention === 0 && (
        <Link href={href} className="underline">View</Link>
      )}
      {online && pending > 0 && !syncing && (
        <button type="button" onClick={() => void sync()} className="font-medium underline">Sync now</button>
      )}
    </div>
  );
}
