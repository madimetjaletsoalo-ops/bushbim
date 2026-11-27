// Sends the outbox to the server when the device is online. One run at a time per tab
// (and across tabs where Web Locks exist). Stops at the first network error.
import { finishOfflinePhoto, startOfflinePhoto, syncChecklistAnswer, syncIssueCreate } from "@/modules/offline/actions";
import { isNetworkError, syncOrder, type SyncResult } from "@/modules/offline/logic";
import { listEntries, offlineUser, removeEntry, updateEntry, type Entry } from "./outbox";

async function put(url: string, headers: Record<string, string>, body: Blob) {
  const res = await fetch(url, { method: "PUT", headers, body });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

async function send(e: Entry, force: boolean): Promise<SyncResult> {
  const c = e.change;
  if (c.kind === "issue.create") return syncIssueCreate(e.projectId, c);
  if (c.kind === "checklist.answer") return syncChecklistAnswer(e.projectId, c, force);
  if (!e.photo || !e.thumb) return { status: "rejected", message: "The photo is missing from this device." };
  const start = await startOfflinePhoto(e.projectId, c);
  if (start.status !== "upload") return start;
  await put(start.ticket.main.url, start.ticket.main.headers, e.photo);
  await put(start.ticket.thumb.url, start.ticket.thumb.headers, e.thumb);
  return finishOfflinePhoto(e.projectId, c, start.ticket.token);
}

const resultHref = (e: Entry, r: SyncResult) =>
  r.status === "applied" && e.kind === "issue.create" && r.resultId ? `/projects/${e.projectId}/issues/${r.resultId}` : undefined;

/** Applies one result to its entry: done ones leave the outbox, conflicts and notices stay for the user. */
async function settle(e: Entry, r: SyncResult) {
  if (r.status === "retry") return;
  if (r.status === "applied" && !r.notice) return removeEntry(e.clientId);
  if (r.status === "applied") return updateEntry(e.clientId, { state: "notice", message: r.notice, resultHref: resultHref(e, r), photo: undefined, thumb: undefined });
  return updateEntry(e.clientId, { state: "conflict", message: r.message, theirs: r.status === "conflict" ? r.theirs : undefined });
}

export type SyncSummary = { applied: number; conflicts: number; offline: boolean };

let running: Promise<SyncSummary> | null = null;

async function run(): Promise<SyncSummary> {
  const summary: SyncSummary = { applied: 0, conflicts: 0, offline: false };
  const user = offlineUser();
  if (!user) return summary;
  const pending = syncOrder((await listEntries()).filter((e) => e.state === "pending" && e.userId === user).map((e) => ({ ...e, madeAt: e.change.madeAt })));
  for (const e of pending) {
    try {
      const r = await send(e, false);
      await settle(e, r);
      if (r.status === "applied") summary.applied++;
      else if (r.status !== "retry") summary.conflicts++;
    } catch (err) {
      if (isNetworkError(err) || !navigator.onLine) {
        summary.offline = true;
        break;
      }
      // a server error: leave it waiting and try the next one
      console.error("offline sync:", err);
    }
  }
  return summary;
}

/** Syncs everything waiting for the signed-in user. Concurrent calls share one run. */
export function syncOutbox(): Promise<SyncSummary> {
  if (running) return running;
  const go = () => run();
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  running = (locks ? (locks.request("bushbim-sync", go) as unknown as Promise<SyncSummary>) : go()).finally(() => {
    running = null;
  });
  return running;
}

/** "Use my answer": sends one conflicting answer again, overwriting the other answer. */
export async function resendWithForce(e: Entry): Promise<SyncResult> {
  const r = await send(e, true);
  await settle(e, r);
  return r;
}
