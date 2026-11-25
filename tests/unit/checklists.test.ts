import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { MemberContext } from "@/lib/permissions";
import { buildChecklistPdf } from "@/modules/checklists/export";
import {
  ITEM_KINDS,
  STARTER_TEMPLATES,
  answerText,
  base64Bytes,
  checklistAccess,
  checklistDetailsSchema,
  checklistLabel,
  isAnswered,
  isSignature,
  issueFromItem,
  moveInList,
  normaliseAnswer,
  parseChecklistAssignee,
  parseListFilters,
  progress,
  statusAfterAnswer,
  templateItemSchema,
} from "@/modules/checklists/logic";

const member = (p: Partial<MemberContext> = {}): MemberContext => ({ userId: "u1", accessLevel: "MEMBER", companyId: "co1", roleIds: ["r1"], services: ["CHECKLISTS"], ...p });
const open = { createdById: "other", assigneeType: null, assigneeId: null, status: "IN_PROGRESS" as const };
// 1×1 transparent PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("starter templates", () => {
  it("ships the three required templates with items of valid kinds", () => {
    expect(STARTER_TEMPLATES.map((t) => t.name)).toEqual(["Villa handover snag list (luxury finishes)", "Thatch roof inspection", "Pool commissioning"]);
    for (const t of STARTER_TEMPLATES) {
      expect(t.sections.length).toBeGreaterThan(1);
      for (const s of t.sections) for (const [label, kind] of s.items) {
        expect(label.length).toBeGreaterThan(0);
        expect(ITEM_KINDS).toContain(kind);
      }
    }
  });
  it("uses every kind of item somewhere", () => {
    const kinds = new Set(STARTER_TEMPLATES.flatMap((t) => t.sections.flatMap((s) => s.items.map((i) => i[1]))));
    expect([...kinds].sort()).toEqual([...ITEM_KINDS].sort());
  });
});

describe("checklistAccess", () => {
  it("lets Viewers see but not answer someone else's checklist", () => {
    const a = checklistAccess("VIEWER", member(), open);
    expect(a).toMatchObject({ see: true, edit: false, answer: false, delete: false });
  });
  it("lets the assignee answer and complete, by user or by company", () => {
    expect(checklistAccess("VIEWER", member(), { ...open, assigneeType: "USER", assigneeId: "u1" }).answer).toBe(true);
    expect(checklistAccess("VIEWER", member(), { ...open, assigneeType: "COMPANY", assigneeId: "co1" }).complete).toBe(true);
    expect(checklistAccess("VIEWER", member(), { ...open, assigneeType: "COMPANY", assigneeId: "co2" }).answer).toBe(false);
    // roles are not checklist assignees
    expect(checklistAccess("VIEWER", member(), { ...open, assigneeType: "ROLE", assigneeId: "r1" }).answer).toBe(false);
  });
  it("lets Creators edit only their own checklists", () => {
    expect(checklistAccess("CREATOR", member(), open).edit).toBe(false);
    expect(checklistAccess("CREATOR", member(), { ...open, createdById: "u1" })).toMatchObject({ edit: true, answer: true, delete: false });
  });
  it("gives Managers everything and locks answers once completed", () => {
    expect(checklistAccess("MANAGER", member(), open)).toMatchObject({ edit: true, answer: true, delete: true, reopen: false });
    const done = checklistAccess("MANAGER", member(), { ...open, status: "COMPLETED" });
    expect(done).toMatchObject({ answer: false, complete: false, reopen: true });
    expect(checklistAccess("VIEWER", member(), { ...open, status: "COMPLETED", assigneeType: "USER", assigneeId: "u1" }).reopen).toBe(false);
  });
  it("gives nothing without the service", () => {
    expect(checklistAccess("NONE", member(), { ...open, createdById: "u1" }).see).toBe(false);
  });
});

describe("answers", () => {
  it("accepts yes/no/N/A only", () => {
    expect(normaliseAnswer("YES_NO", "NO")).toEqual({ value: "NO" });
    expect(normaliseAnswer("YES_NO", "maybe")).toHaveProperty("error");
  });
  it("clears on a blank value", () => {
    expect(normaliseAnswer("TEXT", "   ")).toEqual({ value: null });
  });
  it("normalises numbers with a decimal comma and rejects text", () => {
    expect(normaliseAnswer("NUMBER", "7,4")).toEqual({ value: "7.4" });
    expect(normaliseAnswer("NUMBER", "-12")).toEqual({ value: "-12" });
    expect(normaliseAnswer("NUMBER", "seven")).toHaveProperty("error");
  });
  it("checks dates and text length", () => {
    expect(normaliseAnswer("DATE", "2026-11-24")).toEqual({ value: "2026-11-24" });
    expect(normaliseAnswer("DATE", "24/11/2026")).toHaveProperty("error");
    expect(normaliseAnswer("TEXT", "x".repeat(2001))).toHaveProperty("error");
  });
  it("accepts a small PNG signature and rejects anything else", () => {
    expect(isSignature(PNG)).toBe(true);
    expect(normaliseAnswer("SIGNATURE", PNG)).toEqual({ value: PNG });
    expect(isSignature("data:image/jpeg;base64,/9j/4AAQ")).toBe(false);
    expect(isSignature("data:image/png;base64,PHN2Zz4=")).toBe(false); // not PNG bytes
    expect(isSignature(`data:image/png;base64,iVBORw0KGgo${"A".repeat(120_000)}`)).toBe(false); // too big
  });
  it("never answers photo items as text", () => {
    expect(normaliseAnswer("PHOTO", "x")).toHaveProperty("error");
  });
  it("computes base64 sizes", () => {
    expect(base64Bytes("TWFu")).toBe(3);
    expect(base64Bytes("TWE=")).toBe(2);
    expect(base64Bytes("TQ==")).toBe(1);
  });
});

describe("progress", () => {
  const items = [
    { label: "A", kind: "YES_NO" as const, value: "YES", required: true },
    { label: "B", kind: "YES_NO" as const, value: "NO", required: true },
    { label: "C", kind: "PHOTO" as const, value: null, required: true, photoCount: 0 },
    { label: "D", kind: "TEXT" as const, value: null, required: false },
  ];
  it("counts answered, failed and missing required items", () => {
    const p = progress(items);
    expect(p).toMatchObject({ answered: 2, total: 4, failed: 1, percent: 50 });
    expect(p.missing.map((i) => i.label)).toEqual(["C"]);
  });
  it("treats a photo item as answered once it has a photo", () => {
    expect(isAnswered({ kind: "PHOTO", value: null, required: true, photoCount: 1 })).toBe(true);
    expect(progress(items.map((i) => (i.kind === "PHOTO" ? { ...i, photoCount: 2 } : i))).missing).toHaveLength(0);
  });
  it("moves a not-started checklist to in progress only", () => {
    expect(statusAfterAnswer("NOT_STARTED")).toBe("IN_PROGRESS");
    expect(statusAfterAnswer("IN_PROGRESS")).toBe("IN_PROGRESS");
  });
  it("describes answers for the table and PDF", () => {
    expect(answerText({ kind: "YES_NO", value: "NA" })).toBe("N/A");
    expect(answerText({ kind: "SIGNATURE", value: PNG })).toBe("Signed");
    expect(answerText({ kind: "PHOTO", value: null, photoCount: 2 })).toBe("2 photos");
    expect(answerText({ kind: "NUMBER", value: null })).toBe("");
  });
});

describe("issue from a failed item", () => {
  it("names the item and the checklist, and carries the note", () => {
    const r = issueFromItem({ number: 3, title: "Villa 7 handover" }, "Bathroom", { label: "Showers drain with no ponding", note: "Ponding at the drain" });
    expect(r.title).toBe("Showers drain with no ponding (CL-3)");
    expect(r.description).toContain('CL-3 "Villa 7 handover", section "Bathroom"');
    expect(r.description).toContain("Note: Ponding at the drain");
  });
  it("keeps the title within the issue limit", () => {
    expect(issueFromItem({ number: 12345, title: "x" }, "s", { label: "y".repeat(300), note: null }).title.length).toBeLessThanOrEqual(200);
  });
});

describe("input helpers", () => {
  it("labels and assignees", () => {
    expect(checklistLabel(7)).toBe("CL-7");
    expect(parseChecklistAssignee("COMPANY:abc")).toEqual({ type: "COMPANY", id: "abc" });
    expect(parseChecklistAssignee("ROLE:abc")).toBeNull();
  });
  it("reorders lists", () => {
    expect(moveInList(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveInList(["a", "b", "c"], "c", "down")).toBeNull();
    expect(moveInList(["a"], "z", "up")).toBeNull();
  });
  it("validates template items and details", () => {
    expect(templateItemSchema.safeParse({ label: "Pump primed", kind: "YES_NO", required: true }).success).toBe(true);
    expect(templateItemSchema.safeParse({ label: "", kind: "YES_NO", required: false }).success).toBe(false);
    expect(templateItemSchema.safeParse({ label: "x", kind: "VIDEO", required: false }).success).toBe(false);
    const d = checklistDetailsSchema.parse({ title: " Villa 7 ", assignee: "", locationId: "", dueDate: "2026-12-01" });
    expect(d).toMatchObject({ title: "Villa 7", locationId: null });
    expect(d.dueDate?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
  it("parses list filters", () => {
    expect(parseListFilters({ status: "OPEN", mine: "1", q: " CL-2 " })).toEqual({ status: "OPEN", mine: true, q: "CL-2" });
    expect(parseListFilters({ status: "bogus" }).status).toBe("");
  });
});

describe("PDF", () => {
  it("builds a readable PDF with a signature and non-Latin text", async () => {
    const bytes = await buildChecklistPdf({
      title: "CL-1: Villa 7 handover",
      lines: [["Project", "Kruger Lodge"], ["Location", "North camp › Villa 7"]],
      summary: "3 of 3 items answered, 1 failed.",
      sections: [
        {
          title: "Bathroom",
          items: [
            { label: "Showers drain", required: true, answer: "No", failed: true, note: "Ponding — see photo", issue: "#4 (Open)" },
            { label: "Signed off", required: true, answer: "Signed", failed: false, signature: Buffer.from(PNG.split(",")[1], "base64") },
            { label: "Bad photo bytes are skipped", required: false, answer: "1 photo", failed: false, photos: [new Uint8Array([1, 2, 3])] },
          ],
        },
      ],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBe("CL-1: Villa 7 handover");
  });
});
