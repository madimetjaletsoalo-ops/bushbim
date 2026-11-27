// Pure offline-sync logic, shared by the browser outbox and the server sync actions:
// the shape of a change made offline, merging repeated answers, the order changes are
// sent in, and conflict detection. No database or browser APIs, so it is unit tested.
import { z } from "zod";

export const CHANGE_KINDS = ["issue.create", "checklist.answer", "photo"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

const id = z.string().min(1).max(64);
const clientId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/, "Invalid change id");
const madeAt = z.string().datetime({ offset: true });

/** Fields of the issue form, as [name, value] pairs (watchers repeat). */
export const issueChangeSchema = z.object({
  kind: z.literal("issue.create"),
  clientId,
  madeAt,
  fields: z.array(z.tuple([z.string().max(80), z.string().max(10_000)])).max(200),
});

export const answerChangeSchema = z.object({
  kind: z.literal("checklist.answer"),
  clientId,
  madeAt,
  checklistId: id,
  itemId: id,
  /** the answer; signatures are PNG data URLs, so this can be long */
  value: z.string().max(400_000),
  /** undefined keeps the current note */
  note: z.string().max(5000).optional(),
  /** what the device showed when the answer was given offline */
  base: z.object({ value: z.string().max(400_000).nullable(), note: z.string().max(5000).nullable() }),
});

export const photoTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("issue"), issueId: id }),
  /** an issue that was itself created offline: its server id is looked up when it has synced */
  z.object({ type: z.literal("offline-issue"), issueClientId: clientId }),
  z.object({ type: z.literal("checklist"), checklistId: id, itemId: id }),
  z.object({ type: z.literal("project") }),
]);
export type PhotoTarget = z.infer<typeof photoTargetSchema>;

export const photoChangeSchema = z.object({
  kind: z.literal("photo"),
  clientId,
  madeAt,
  target: photoTargetSchema,
  name: z.string().min(1).max(200),
  caption: z.string().max(500),
  size: z.number().int().positive(),
  thumbSize: z.number().int().positive(),
});

export type IssueChange = z.infer<typeof issueChangeSchema>;
export type AnswerChange = z.infer<typeof answerChangeSchema>;
export type PhotoChange = z.infer<typeof photoChangeSchema>;
export type Change = IssueChange | AnswerChange | PhotoChange;

/** What the server reports for a change. "applied" may carry a notice (applied with changes). */
export type SyncResult =
  | { status: "applied"; resultId: string | null; notice?: string }
  | { status: "conflict"; message: string; theirs?: { value: string | null; note: string | null; by: string | null; at: string | null } }
  | { status: "rejected"; message: string }
  /** not yet: e.g. a photo whose offline issue hasn't synced */
  | { status: "retry"; message: string };

/** Changes are sent issues first (photos may belong to them), then answers, then photos; oldest first. */
const KIND_ORDER: Record<ChangeKind, number> = { "issue.create": 0, "checklist.answer": 1, photo: 2 };
export function syncOrder<T extends { kind: ChangeKind; madeAt: string }>(changes: T[]): T[] {
  return [...changes].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.madeAt.localeCompare(b.madeAt));
}

/**
 * A second offline answer to the same item replaces the first one still waiting, keeping the
 * first one's id and base: the server then compares against what the device first saw, and a
 * user who changes their mind twice offline isn't shown a conflict with themselves.
 */
export function mergeAnswer(pending: AnswerChange, next: AnswerChange): AnswerChange {
  return {
    ...pending,
    madeAt: next.madeAt,
    value: next.value,
    note: next.note !== undefined ? next.note : pending.note,
  };
}

/**
 * Whether an offline answer clashes with what is on the server now. It clashes when someone
 * else changed the value (or the note, if this change sets one) after the device last saw it,
 * to something other than this answer. Identical answers never clash.
 */
export function answerConflicts(
  base: { value: string | null; note: string | null },
  current: { value: string | null; note: string | null },
  mine: { value: string | null; note?: string | null },
): boolean {
  const norm = (v: string | null | undefined) => (v ?? "").trim() || null;
  const valueMoved = norm(current.value) !== norm(base.value) && norm(current.value) !== norm(mine.value);
  const noteMoved = mine.note !== undefined && norm(current.note) !== norm(base.note) && norm(current.note) !== norm(mine.note);
  return valueMoved || noteMoved;
}

/** The fields an offline issue keeps when some of its choices are no longer valid. */
export const BASIC_ISSUE_FIELDS = ["title", "description", "dueDate"] as const;
export function basicIssueFields(fields: [string, string][]): [string, string][] {
  return fields.filter(([k]) => (BASIC_ISSUE_FIELDS as readonly string[]).includes(k));
}

/** The title of an offline issue, for lists and notices. */
export const issueTitleOf = (fields: [string, string][]) => fields.find(([k]) => k === "title")?.[1]?.trim() || "Untitled issue";

/** Turns form entries into [name, value] pairs, dropping files and Next.js's internal fields. */
export function formPairs(entries: Iterable<[string, unknown]>): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of entries) if (typeof v === "string" && !k.startsWith("$ACTION")) out.push([k, v]);
  return out;
}

/** Whether an error from calling the server means "no connection" rather than a real failure. */
export function isNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  return e instanceof TypeError && /fetch|network|load failed|connection/i.test(e.message);
}

/** "3 changes waiting to sync" */
export function pendingText(n: number): string {
  return n === 1 ? "1 change waiting to sync" : `${n} changes waiting to sync`;
}
