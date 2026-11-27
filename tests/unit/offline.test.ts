import { describe, expect, it } from "vitest";
import {
  answerChangeSchema,
  answerConflicts,
  basicIssueFields,
  formPairs,
  isNetworkError,
  issueChangeSchema,
  issueTitleOf,
  mergeAnswer,
  pendingText,
  photoChangeSchema,
  syncOrder,
  type AnswerChange,
} from "@/modules/offline/logic";

const at = (m: number) => new Date(Date.UTC(2026, 10, 27, 8, m)).toISOString();

describe("syncOrder", () => {
  it("sends issues, then answers, then photos, oldest first", () => {
    const list = [
      { kind: "photo" as const, madeAt: at(1), id: "p" },
      { kind: "checklist.answer" as const, madeAt: at(3), id: "a2" },
      { kind: "issue.create" as const, madeAt: at(5), id: "i" },
      { kind: "checklist.answer" as const, madeAt: at(2), id: "a1" },
    ];
    expect(syncOrder(list).map((x) => x.id)).toEqual(["i", "a1", "a2", "p"]);
  });
});

describe("answerConflicts", () => {
  const base = { value: null, note: null };
  it("no conflict when nobody else touched the item", () => {
    expect(answerConflicts(base, { value: null, note: null }, { value: "YES" })).toBe(false);
  });
  it("conflict when someone else answered differently", () => {
    expect(answerConflicts(base, { value: "NO", note: null }, { value: "YES" })).toBe(true);
  });
  it("no conflict when they gave the same answer", () => {
    expect(answerConflicts(base, { value: "YES", note: null }, { value: "YES" })).toBe(false);
  });
  it("a changed note only matters when this answer sets a note", () => {
    expect(answerConflicts({ value: "NO", note: null }, { value: "NO", note: "Chipped" }, { value: "NO" })).toBe(false);
    expect(answerConflicts({ value: "NO", note: null }, { value: "NO", note: "Chipped" }, { value: "NO", note: "Cracked" })).toBe(true);
  });
  it("treats blank and null alike", () => {
    expect(answerConflicts({ value: "", note: "" }, { value: null, note: null }, { value: "YES", note: "" })).toBe(false);
  });
});

it("a second offline answer replaces the first but keeps its id and base", () => {
  const first: AnswerChange = { kind: "checklist.answer", clientId: "aaaaaaaa-1", madeAt: at(1), checklistId: "c", itemId: "i", value: "NO", note: "Cracked", base: { value: null, note: null } };
  const second: AnswerChange = { ...first, clientId: "bbbbbbbb-2", madeAt: at(4), value: "YES", note: undefined, base: { value: "NO", note: "Cracked" } };
  expect(mergeAnswer(first, second)).toEqual({ ...first, madeAt: at(4), value: "YES", note: "Cracked" });
});

describe("change schemas", () => {
  it("accepts a valid offline issue and rejects a bad id", () => {
    const ok = { kind: "issue.create", clientId: "0f8fad5b-d9cb-469f-a165-70867728950e", madeAt: at(0), fields: [["title", "Cracked tile"], ["watcherIds", "u1"], ["watcherIds", "u2"]] };
    expect(issueChangeSchema.safeParse(ok).success).toBe(true);
    expect(issueChangeSchema.safeParse({ ...ok, clientId: "../../x" }).success).toBe(false);
  });
  it("accepts answers with or without a note", () => {
    const a = { kind: "checklist.answer", clientId: "0f8fad5b-d9cb", madeAt: at(0), checklistId: "c1", itemId: "i1", value: "YES", base: { value: null, note: null } };
    expect(answerChangeSchema.safeParse(a).success).toBe(true);
    expect(answerChangeSchema.safeParse({ ...a, note: "ok" }).success).toBe(true);
    expect(answerChangeSchema.safeParse({ ...a, base: undefined }).success).toBe(false);
  });
  it("accepts every photo target", () => {
    const p = { kind: "photo", clientId: "0f8fad5b-d9cb", madeAt: at(0), name: "IMG_1.jpg", caption: "", size: 1000, thumbSize: 100 };
    for (const target of [{ type: "issue", issueId: "i1" }, { type: "offline-issue", issueClientId: "0f8fad5b-aaaa" }, { type: "checklist", checklistId: "c", itemId: "i" }, { type: "project" }])
      expect(photoChangeSchema.safeParse({ ...p, target }).success).toBe(true);
    expect(photoChangeSchema.safeParse({ ...p, target: { type: "daily-log" } }).success).toBe(false);
    expect(photoChangeSchema.safeParse({ ...p, target: { type: "project" }, size: 0 }).success).toBe(false);
  });
});

it("keeps only title, description and due date when an offline issue's choices are stale", () => {
  const f: [string, string][] = [["title", "Leak"], ["assignee", "USER:x"], ["description", "Roof"], ["locationId", "l"], ["dueDate", "2026-12-01"]];
  expect(basicIssueFields(f)).toEqual([["title", "Leak"], ["description", "Roof"], ["dueDate", "2026-12-01"]]);
  expect(issueTitleOf(f)).toBe("Leak");
  expect(issueTitleOf([["title", "  "]])).toBe("Untitled issue");
});

it("drops files and Next.js internals from form entries", () => {
  const entries: [string, unknown][] = [["title", "A"], ["$ACTION_ID_abc", ""], ["photo", new Blob(["x"])], ["watcherIds", "u1"]];
  expect(formPairs(entries)).toEqual([["title", "A"], ["watcherIds", "u1"]]);
});

it("recognises network errors", () => {
  expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
  expect(isNetworkError(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
  expect(isNetworkError(Object.assign(new Error("timeout"), { name: "TimeoutError" }))).toBe(true);
  expect(isNetworkError(new Error("NEXT_REDIRECT"))).toBe(false);
  expect(isNetworkError("nope")).toBe(false);
});

it("counts waiting changes", () => {
  expect(pendingText(1)).toBe("1 change waiting to sync");
  expect(pendingText(3)).toBe("3 changes waiting to sync");
});
