// Browser-only outbox: changes made offline, kept in IndexedDB until they sync.
// Photos are stored as compressed JPEG blobs next to their change.
import { mergeAnswer, type AnswerChange, type Change, type ChangeKind, type SyncResult } from "@/modules/offline/logic";

export type EntryState = "pending" | "conflict" | "notice";

export type Entry = {
  clientId: string;
  projectId: string;
  userId: string;
  kind: ChangeKind;
  change: Change;
  /** shown in lists: issue title, checklist item label, photo name */
  label: string;
  /** page the change belongs to (checklist, issue) */
  href?: string;
  state: EntryState;
  message?: string;
  theirs?: Extract<SyncResult, { status: "conflict" }>["theirs"];
  resultHref?: string;
  photo?: Blob;
  thumb?: Blob;
  createdAt: string;
};

const DB = "bushbim-offline";
const STORE = "outbox";
const EVENT = "bushbim-outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "clientId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

let channel: BroadcastChannel | null = null;
function changed() {
  window.dispatchEvent(new Event(EVENT));
  try {
    channel ??= new BroadcastChannel(EVENT);
    channel.postMessage("changed");
  } catch {
    // older browsers: this tab only
  }
}

/** Calls `fn` whenever the outbox changes, in this tab or another. Returns an unsubscribe. */
export function onOutboxChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(EVENT);
    bc.onmessage = fn;
  } catch {
    bc = null;
  }
  return () => {
    window.removeEventListener(EVENT, fn);
    bc?.close();
  };
}

export async function listEntries(): Promise<Entry[]> {
  try {
    const all = (await tx<Entry[]>("readonly", (s) => s.getAll() as IDBRequest<Entry[]>)) ?? [];
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export async function putEntry(e: Entry) {
  await tx("readwrite", (s) => void s.put(e));
  changed();
}

export async function removeEntry(clientId: string) {
  await tx("readwrite", (s) => void s.delete(clientId));
  changed();
}

export async function updateEntry(clientId: string, patch: Partial<Entry>) {
  const all = await listEntries();
  const e = all.find((x) => x.clientId === clientId);
  if (e) await putEntry({ ...e, ...patch });
}

export const newClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** Adds a change. A second answer to an item still waiting replaces the first. */
export async function addChange(e: Omit<Entry, "state" | "createdAt">): Promise<Entry> {
  if (e.change.kind === "checklist.answer") {
    const next = e.change;
    const waiting = (await listEntries()).find(
      (x) => x.state === "pending" && x.userId === e.userId && x.change.kind === "checklist.answer" && x.change.itemId === next.itemId,
    );
    if (waiting) {
      const merged: Entry = { ...waiting, change: mergeAnswer(waiting.change as AnswerChange, next) };
      await putEntry(merged);
      return merged;
    }
  }
  const entry: Entry = { ...e, state: "pending", createdAt: new Date().toISOString() };
  await putEntry(entry);
  return entry;
}

// the signed-in user, so changes are only ever synced by the person who made them
const USER_KEY = "bushbim-user";
let currentUser: string | null = null;
/** Records who is signed in. Returns true when someone else used this device before. */
export function setOfflineUser(id: string): boolean {
  currentUser = id;
  try {
    const before = localStorage.getItem(USER_KEY);
    localStorage.setItem(USER_KEY, id);
    return !!before && before !== id;
  } catch {
    // private mode
    return false;
  }
}
export function offlineUser(): string | null {
  if (currentUser) return currentUser;
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}
