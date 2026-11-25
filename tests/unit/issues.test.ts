import { describe, expect, it } from "vitest";
import type { MemberContext } from "@/lib/permissions";
import {
  DEFAULT_STATUSES,
  activeFilterCount,
  buildIssueWhere,
  changedFields,
  csvCell,
  expandStatusIds,
  fieldLabels,
  filterQuery,
  isAssignedTo,
  isOverdue,
  issueAccess,
  issueSchema,
  orderStatuses,
  parseAssignee,
  parseFilters,
  parseOptions,
  statusLabel,
  toCsv,
  todayIn,
  validateAttributes,
  zonedDayStart,
} from "@/modules/issues/logic";

const member = (over: Partial<MemberContext> = {}): MemberContext => ({
  userId: "u1",
  accessLevel: "MEMBER",
  companyId: "c1",
  roleIds: ["r1"],
  services: ["ISSUES"],
  ...over,
});
const issue = (over = {}) => ({ createdById: "u9", assigneeType: null, assigneeId: null, draft: false, ...over }) as Parameters<typeof issueAccess>[2];

describe("default statuses", () => {
  it("has the nine default statuses in order with one default, Draft as draft and Closed/Void closed", () => {
    expect(DEFAULT_STATUSES.map((s) => s.name)).toEqual(["Draft", "Open", "Answered", "Work completed", "Ready to inspect", "Not approved", "In dispute", "Closed", "Void"]);
    expect(DEFAULT_STATUSES.filter((s) => s.isDefault).map((s) => s.name)).toEqual(["Open"]);
    expect(DEFAULT_STATUSES.filter((s) => s.closed).map((s) => s.name)).toEqual(["Closed", "Void"]);
    expect(DEFAULT_STATUSES.filter((s) => s.draft).map((s) => s.name)).toEqual(["Draft"]);
  });
});

describe("issueAccess", () => {
  it("Viewers see and comment but can't edit or change status", () => {
    expect(issueAccess("VIEWER", member(), issue())).toEqual({ see: true, edit: false, status: false, comment: true });
  });
  it("a Creator edits only their own issues", () => {
    expect(issueAccess("CREATOR", member(), issue({ createdById: "u1" })).edit).toBe(true);
    expect(issueAccess("CREATOR", member(), issue()).edit).toBe(false);
  });
  it("Managers edit any issue", () => {
    expect(issueAccess("MANAGER", member(), issue()).edit).toBe(true);
  });
  it("the assignee may change status by user, role or company", () => {
    expect(issueAccess("VIEWER", member(), issue({ assigneeType: "USER", assigneeId: "u1" })).status).toBe(true);
    expect(issueAccess("VIEWER", member(), issue({ assigneeType: "ROLE", assigneeId: "r1" })).status).toBe(true);
    expect(issueAccess("VIEWER", member(), issue({ assigneeType: "COMPANY", assigneeId: "c1" })).status).toBe(true);
    expect(issueAccess("VIEWER", member(), issue({ assigneeType: "COMPANY", assigneeId: "c2" })).status).toBe(false);
  });
  it("drafts are visible only to their creator and Managers", () => {
    expect(issueAccess("CREATOR", member(), issue({ draft: true })).see).toBe(false);
    expect(issueAccess("CREATOR", member(), issue({ draft: true, createdById: "u1" })).see).toBe(true);
    expect(issueAccess("MANAGER", member(), issue({ draft: true })).see).toBe(true);
  });
  it("no access without the service", () => {
    expect(issueAccess("NONE", member(), issue({ createdById: "u1" }))).toEqual({ see: false, edit: false, status: false, comment: false });
  });
  it("isAssignedTo is false when unassigned", () => {
    expect(isAssignedTo(member(), { assigneeType: null, assigneeId: null })).toBe(false);
  });
});

describe("statuses", () => {
  const s = (id: string, order: number, parentId: string | null = null) => ({ id, name: id, color: "#000000", parentId, closed: false, draft: false, order });
  const list = [s("closed", 2), s("open", 1), s("open-sub-b", 1, "open"), s("open-sub-a", 0, "open"), s("draft", 0)];
  it("orders top-level statuses with their sub-statuses after them", () => {
    expect(orderStatuses(list).map((x) => [x.id, x.depth])).toEqual([
      ["draft", 0],
      ["open", 0],
      ["open-sub-a", 1],
      ["open-sub-b", 1],
      ["closed", 0],
    ]);
  });
  it("a chosen parent status also matches its sub-statuses; unknown ids are dropped", () => {
    expect(expandStatusIds(["open", "nope"], list).sort()).toEqual(["open", "open-sub-a", "open-sub-b"]);
    expect(expandStatusIds(["open-sub-a"], list)).toEqual(["open-sub-a"]);
  });
  it("labels sub-statuses with their parent", () => {
    expect(statusLabel({ name: "open-sub-a", parentId: "open" }, list)).toBe("open › open-sub-a");
    expect(statusLabel({ name: "open", parentId: null }, list)).toBe("open");
  });
});

describe("dates", () => {
  it("finds the start of a day in a time zone", () => {
    expect(zonedDayStart("2026-11-23", "Africa/Johannesburg").toISOString()).toBe("2026-11-22T22:00:00.000Z");
    expect(zonedDayStart("2026-11-23", "Africa/Lagos").toISOString()).toBe("2026-11-22T23:00:00.000Z");
    expect(zonedDayStart("2026-07-01", "Europe/London").toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(zonedDayStart("2026-11-23", "UTC").toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });
  it("today and overdue follow the project time zone", () => {
    const lateEvening = new Date("2026-11-23T23:30:00Z"); // already the 24th in Johannesburg
    expect(todayIn("Africa/Johannesburg", lateEvening)).toBe("2026-11-24");
    const due = new Date("2026-11-23T00:00:00Z");
    expect(isOverdue(due, false, "Africa/Johannesburg", lateEvening)).toBe(true);
    expect(isOverdue(due, false, "UTC", lateEvening)).toBe(false);
    expect(isOverdue(due, true, "Africa/Johannesburg", lateEvening)).toBe(false);
    expect(isOverdue(null, false, "UTC", lateEvening)).toBe(false);
  });
});

describe("custom attributes", () => {
  const defs = [
    { id: "a1", name: "Trade", kind: "LIST" as const, options: ["Thatching", "Joinery"] },
    { id: "a2", name: "Cost", kind: "NUMBER" as const, options: [] },
    { id: "a3", name: "Inspected", kind: "DATE" as const, options: [] },
    { id: "a4", name: "Note", kind: "TEXT" as const, options: [] },
  ];
  it("keeps valid values and drops blanks", () => {
    expect(validateAttributes(defs, { a1: "Thatching", a2: "1250.50", a3: "2026-11-23", a4: "  ", zz: "ignored" })).toEqual({
      values: { a1: "Thatching", a2: "1250.50", a3: "2026-11-23" },
    });
  });
  it("rejects bad values", () => {
    expect(validateAttributes(defs, { a1: "Plumbing" })).toEqual({ error: "Trade must be one of its options." });
    expect(validateAttributes(defs, { a2: "R100" })).toEqual({ error: "Cost must be a number." });
    expect(validateAttributes(defs, { a3: "23/11/2026" })).toEqual({ error: "Inspected must be a date." });
  });
  it("parses list options", () => {
    expect(parseOptions("Thatching, Joinery\nThatching\n ,Pools")).toEqual(["Thatching", "Joinery", "Pools"]);
  });
});

describe("issue input", () => {
  const base = { title: "Cracked tile", description: "", typeId: "", subtypeId: "", statusId: "", assignee: "", dueDate: "", locationId: "", rootCauseId: "", watcherIds: [] };
  it("needs a title and turns blanks into nulls", () => {
    expect(issueSchema.safeParse({ ...base, title: "  " }).success).toBe(false);
    const r = issueSchema.parse({ ...base, dueDate: "2026-12-01" });
    expect(r.typeId).toBeNull();
    expect(r.dueDate?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
  it("rejects a malformed due date", () => {
    expect(issueSchema.safeParse({ ...base, dueDate: "next week" }).success).toBe(false);
  });
  it("parses assignees", () => {
    expect(parseAssignee("ROLE:abc123")).toEqual({ type: "ROLE", id: "abc123" });
    expect(parseAssignee("GROUP:abc")).toBeNull();
    expect(parseAssignee("USER:")).toBeNull();
  });
  it("lists changed fields with readable names", () => {
    const before = { title: "A", dueDate: new Date("2026-01-01"), assigneeType: null, assigneeId: null, attributes: { a: "1" } };
    const after = { title: "A", dueDate: new Date("2026-01-02"), assigneeType: "USER", assigneeId: "u1", attributes: { a: "1" } };
    expect(fieldLabels(changedFields(before, after))).toEqual(["due date", "assignee"]);
  });
});

describe("filters", () => {
  const statuses = [
    { id: "open", parentId: null },
    { id: "open-sub", parentId: "open" },
  ];
  it("parses the filter panel and round-trips to a query string", () => {
    const f = parseFilters({ q: " leak ", type: ["t1", "t2"], status: "open", createdBy: "u1", assignee: "COMPANY:c1", from: "2026-11-01", to: "bad", a_x1: "Thatching", a_x2: "" });
    expect(f).toEqual({ q: "leak", typeIds: ["t1", "t2"], statusIds: ["open"], createdById: "u1", assignee: "COMPANY:c1", createdFrom: "2026-11-01", createdTo: "", attrs: { x1: "Thatching" } });
    expect(activeFilterCount(f)).toBe(7);
    expect(parseFilters(Object.fromEntries(new URLSearchParams(filterQuery(f))))).toMatchObject({ q: "leak", assignee: "COMPANY:c1", attrs: { x1: "Thatching" } });
    expect(parseFilters({ assignee: "nobody" }).assignee).toBe("");
  });
  it("builds a where clause: drafts hidden for non-managers, statuses expanded, dates in the project zone", () => {
    const f = parseFilters({ q: "#12", status: "open", assignee: "USER:u2", from: "2026-11-01", to: "2026-11-30", a_x1: "Thatching", a_x2: "roof" });
    const where = buildIssueWhere("p1", f, {
      statuses,
      attributes: [
        { id: "x1", kind: "LIST" },
        { id: "x2", kind: "TEXT" },
      ],
      timeZone: "Africa/Johannesburg",
      userId: "u1",
      manager: false,
    });
    expect(where.projectId).toBe("p1");
    expect(where.AND).toEqual([
      { OR: [{ status: { draft: false } }, { createdById: "u1" }] },
      { OR: [{ title: { contains: "#12", mode: "insensitive" } }, { description: { contains: "#12", mode: "insensitive" } }, { number: 12 }] },
      { statusId: { in: ["open", "open-sub"] } },
      { assigneeType: "USER", assigneeId: "u2" },
      { createdAt: { gte: new Date("2026-10-31T22:00:00Z") } },
      { createdAt: { lt: new Date("2026-11-30T22:00:00Z") } },
      { attributes: { path: ["x1"], equals: "Thatching" } },
      { attributes: { path: ["x2"], string_contains: "roof" } },
    ]);
  });
  it("managers see drafts and unknown attributes are ignored", () => {
    const where = buildIssueWhere("p1", parseFilters({ a_gone: "x" }), { statuses, attributes: [], timeZone: "UTC", userId: "u1", manager: true });
    expect(where.AND).toEqual([]);
  });
});

describe("CSV", () => {
  it("quotes commas, quotes and new lines", () => {
    expect(csvCell('Villa 3, "east" deck')).toBe('"Villa 3, ""east"" deck"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
  });
  it("defuses spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+27 82 000")).toBe("'+27 82 000");
    expect(csvCell("@sum")).toBe("'@sum");
  });
  it("joins rows with CRLF", () => {
    expect(toCsv([["ID", "Title"], ["#1", "Leak"]])).toBe("ID,Title\r\n#1,Leak\r\n");
  });
});
