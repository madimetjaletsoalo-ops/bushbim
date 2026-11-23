import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATUSES,
  matchesSearch,
  matchesSubject,
  parseStatuses,
  readWorkflowForm,
  searchTerms,
  stepComplete,
  stepResults,
  workflowSchema,
  worst,
  type Decision,
} from "@/modules/reviews/logic";
import { wrap } from "@/modules/reviews/export";

const member = { userId: "u1", roleIds: ["r-arch"], companyId: "c-qs" };

describe("matchesSubject", () => {
  it("matches by user, role or company", () => {
    expect(matchesSubject(member, ["USER:u1"])).toBe(true);
    expect(matchesSubject(member, ["ROLE:r-arch"])).toBe(true);
    expect(matchesSubject(member, ["COMPANY:c-qs"])).toBe(true);
    expect(matchesSubject(member, ["USER:u2", "ROLE:r-eng", "COMPANY:c-mep"])).toBe(false);
    expect(matchesSubject({ ...member, companyId: null }, ["COMPANY:"])).toBe(false);
    expect(matchesSubject(member, [])).toBe(false);
  });
});

describe("outcomes", () => {
  it("picks the worst decision", () => {
    expect(worst(["APPROVED", "APPROVED_WITH_COMMENTS"])).toBe("APPROVED_WITH_COMMENTS");
    expect(worst(["REVISE_RESUBMIT", "REJECTED", "APPROVED"])).toBe("REJECTED");
    expect(worst([])).toBeNull();
  });
  it("falls back to default statuses for bad stored values", () => {
    expect(parseStatuses("nope")).toEqual(DEFAULT_STATUSES);
    expect(parseStatuses([{ code: "APPROVED", label: "Accepted" }])).toEqual([{ code: "APPROVED", label: "Accepted" }]);
  });
});

describe("step progress", () => {
  const docs = ["d1", "d2"];
  const d = (reviewerId: string, documentId: string, outcome: Decision["outcome"]): Decision => ({ reviewerId, documentId, outcome });

  it("ANY completes once one reviewer decided on every file", () => {
    expect(stepComplete("ANY", [d("a", "d1", "APPROVED")], docs, ["a", "b"])).toBe(false);
    expect(stepComplete("ANY", [d("a", "d1", "APPROVED"), d("a", "d2", "REJECTED")], docs, ["a", "b"])).toBe(true);
  });

  it("ALL needs every eligible reviewer", () => {
    const one = [d("a", "d1", "APPROVED"), d("a", "d2", "APPROVED")];
    expect(stepComplete("ALL", one, docs, ["a", "b"])).toBe(false);
    const both = [...one, d("b", "d1", "APPROVED"), d("b", "d2", "REVISE_RESUBMIT")];
    expect(stepComplete("ALL", both, docs, ["a", "b"])).toBe(true);
    // b lost access after responding: still complete
    expect(stepComplete("ALL", both, docs, ["a"])).toBe(true);
    expect(stepComplete("ALL", [], docs, [])).toBe(false);
  });

  it("each file's result is the worst among finished reviewers", () => {
    const list = [d("a", "d1", "APPROVED"), d("a", "d2", "APPROVED"), d("b", "d1", "REJECTED"), d("b", "d2", "APPROVED_WITH_COMMENTS"), d("c", "d1", "REJECTED")];
    // c didn't finish (no decision on d2), so c's REJECTED on d1 is ignored… but b's counts
    const r = stepResults(list, docs);
    expect(r.get("d1")).toBe("REJECTED");
    expect(r.get("d2")).toBe("APPROVED_WITH_COMMENTS");
    expect(stepResults([d("c", "d1", "REJECTED")], docs).size).toBe(0);
  });
});

describe("workflow form", () => {
  const form = (entries: [string, string][]) => {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  };

  it("reads steps, skipping empty ones, and the chosen statuses", () => {
    const raw = readWorkflowForm(
      form([
        ["name", "Design approval"],
        ["status_APPROVED", "on"],
        ["label_APPROVED", "Accepted"],
        ["status_REJECTED", "on"],
        ["label_REJECTED", ""],
        ["step1Name", "Architect"],
        ["step1Reviewers", "USER:u1"],
        ["step1Reviewers", "ROLE:r1"],
        ["step1Mode", "ALL"],
        ["step1Days", "3"],
        ["step2Name", ""],
        ["step3Name", "Client"],
        ["step3Reviewers", "COMPANY:c1"],
        ["initiators", "USER:u9"],
        ["approvedFolderId", "f-ifc"],
      ]),
    );
    const p = workflowSchema.parse(raw);
    expect(p.steps.map((s) => [s.name, s.reviewers, s.mode, s.days])).toEqual([
      ["Architect", ["USER:u1", "ROLE:r1"], "ALL", 3],
      ["Client", ["COMPANY:c1"], "ANY", 5],
    ]);
    expect(p.statuses).toEqual([
      { code: "APPROVED", label: "Accepted" },
      { code: "REJECTED", label: "Rejected" },
    ]);
    expect(p.initiators).toEqual(["USER:u9"]);
    expect(p.autoStartFolderId).toBeNull();
    expect(p.approvedFolderId).toBe("f-ifc");
  });

  it("rejects a step without reviewers, no statuses, and bad subjects", () => {
    const bad = (entries: [string, string][]) => workflowSchema.safeParse(readWorkflowForm(form(entries))).success;
    expect(bad([["name", "X"], ["status_APPROVED", "on"], ["step1Name", "A"]])).toBe(false);
    expect(bad([["name", "X"], ["step1Name", "A"], ["step1Reviewers", "USER:u1"]])).toBe(false);
    expect(bad([["name", "X"], ["status_APPROVED", "on"], ["step1Name", "A"], ["step1Reviewers", "ADMIN:u1"]])).toBe(false);
    expect(bad([["name", "X"], ["status_APPROVED", "on"], ["step1Name", "A"], ["step1Reviewers", "USER:u1"], ["step1Days", "90"]])).toBe(false);
    expect(bad([["name", "X"], ["status_APPROVED", "on"], ["step1Name", "A"], ["step1Reviewers", "USER:u1"]])).toBe(true);
  });
});

describe("search", () => {
  it("matches every term against names, files and comments, and #number", () => {
    const texts = ["Villa 4 IFC", "Two-step", "Thandi Architect", "A-101.pdf", "Move the door 300mm"];
    expect(matchesSearch(searchTerms("villa door"), 7, texts)).toBe(true);
    expect(matchesSearch(searchTerms("#7"), 7, texts)).toBe(true);
    expect(matchesSearch(searchTerms("#8"), 7, texts)).toBe(false);
    expect(matchesSearch(searchTerms("villa roof"), 7, texts)).toBe(false);
    expect(matchesSearch(searchTerms(""), 7, texts)).toBe(true);
  });
});

describe("wrap", () => {
  const measure = (s: string) => s.length;
  it("wraps words and splits long ones", () => {
    expect(wrap("the quick brown fox", 10, measure)).toEqual(["the quick", "brown fox"]);
    expect(wrap("abcdefghijkl", 5, measure)).toEqual(["abcde", "fghij", "kl"]);
    expect(wrap("a\nb", 10, measure)).toEqual(["a", "b"]);
  });
});
