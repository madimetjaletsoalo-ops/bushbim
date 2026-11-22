import { describe, expect, it } from "vitest";
import {
  ancestors,
  buildTree,
  checkName,
  contentDisposition,
  fileKind,
  formatBytes,
  nameKey,
  parseSort,
  sortItems,
  storageKey,
  subtreeIds,
  type FlatFolder,
} from "@/modules/docs/logic";
import { secretBytes, signToken, transferClaims, uploadClaims, verifyToken } from "@/modules/docs/token";

describe("checkName", () => {
  it("trims and collapses whitespace", () => {
    expect(checkName("  Site   plan.pdf ")).toEqual({ ok: true, name: "Site plan.pdf" });
  });
  it.each(["", "   ", "a/b", "a\\b", "what?", "x:y", ".", "..", "bell\u0007name"])("rejects %j", (n) => {
    expect(checkName(n).ok).toBe(false);
  });
  it("rejects names over 200 characters", () => {
    expect(checkName("a".repeat(201)).ok).toBe(false);
    expect(checkName("a".repeat(200)).ok).toBe(true);
  });
});

describe("nameKey", () => {
  it("makes names that differ only by case stack together", () => {
    expect(nameKey("A-101 Ground Floor.PDF")).toBe(nameKey("a-101 ground floor.pdf"));
  });
});

describe("parseSort", () => {
  it("defaults to name ascending", () => expect(parseSort()).toEqual({ sort: "name", dir: "asc" }));
  it("defaults date and size to newest/largest first", () => {
    expect(parseSort("date")).toEqual({ sort: "date", dir: "desc" });
    expect(parseSort("size")).toEqual({ sort: "size", dir: "desc" });
  });
  it("ignores junk", () => expect(parseSort("drop table", "sideways")).toEqual({ sort: "name", dir: "asc" }));
});

describe("sortItems", () => {
  const d = (s: string) => new Date(s);
  const items = [
    { name: "A-1010.pdf", updatedAt: d("2026-01-03"), size: 300 },
    { name: "a-102.pdf", updatedAt: d("2026-01-01"), size: 100 },
    { name: "B-001.pdf", updatedAt: d("2026-01-02"), size: 100 },
  ];
  it("sorts names naturally and case-insensitively", () => {
    expect(sortItems(items, "name", "asc").map((i) => i.name)).toEqual(["a-102.pdf", "A-1010.pdf", "B-001.pdf"]);
  });
  it("sorts by date", () => {
    expect(sortItems(items, "date", "desc").map((i) => i.name)).toEqual(["A-1010.pdf", "B-001.pdf", "a-102.pdf"]);
  });
  it("sorts by size, ties broken by name", () => {
    expect(sortItems(items, "size", "asc").map((i) => i.name)).toEqual(["a-102.pdf", "B-001.pdf", "A-1010.pdf"]);
  });
  it("does not mutate its input", () => {
    const copy = [...items];
    sortItems(items, "size", "desc");
    expect(items).toEqual(copy);
  });
});

const folders: FlatFolder[] = [
  { id: "pf", parentId: null, name: "Project Files", root: "PROJECT_FILES" },
  { id: "pl", parentId: null, name: "Plans", root: "PLANS" },
  { id: "s", parentId: "pl", name: "Structural", root: null },
  { id: "a", parentId: "pl", name: "Architectural", root: null },
  { id: "a1", parentId: "a", name: "Villas", root: null },
  { id: "a2", parentId: "a1", name: "Villa 10", root: null },
  { id: "a3", parentId: "a1", name: "Villa 2", root: null },
];

describe("buildTree", () => {
  it("puts Plans before Project Files and sorts children naturally", () => {
    const tree = buildTree(folders);
    expect(tree.map((n) => n.name)).toEqual(["Plans", "Project Files"]);
    expect(tree[0].children.map((n) => n.name)).toEqual(["Architectural", "Structural"]);
    expect(tree[0].children[0].children[0].children.map((n) => n.name)).toEqual(["Villa 2", "Villa 10"]);
  });
  it("drops orphans whose parent is missing", () => {
    const tree = buildTree([...folders, { id: "x", parentId: "gone", name: "Orphan", root: null }]);
    expect(JSON.stringify(tree)).not.toContain("Orphan");
  });
});

describe("ancestors / subtreeIds", () => {
  it("returns the breadcrumb path", () => {
    expect(ancestors(folders, "a2").map((f) => f.name)).toEqual(["Plans", "Architectural", "Villas", "Villa 10"]);
    expect(ancestors(folders, "nope")).toEqual([]);
  });
  it("survives a cycle", () => {
    const cyc = [{ id: "x", parentId: "y" }, { id: "y", parentId: "x" }];
    expect(ancestors(cyc, "x")).toHaveLength(2);
    expect(subtreeIds(cyc, "x").sort()).toEqual(["x", "y"]);
  });
  it("collects a folder and everything below it", () => {
    expect(subtreeIds(folders, "a").sort()).toEqual(["a", "a1", "a2", "a3"]);
    expect(subtreeIds(folders, "s")).toEqual(["s"]);
  });
});

describe("storage helpers", () => {
  it("builds a project-scoped key keeping a safe extension", () => {
    expect(storageKey("p1", "Site Plan.PDF", "abc")).toBe("projects/p1/docs/abc.pdf");
    expect(storageKey("p1", "README", "abc")).toBe("projects/p1/docs/abc");
    expect(storageKey("p1", "x.../../etc", "abc")).toBe("projects/p1/docs/abc");
  });
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });
  it("labels file kinds", () => {
    expect(fileKind("a.pdf")).toBe("PDF");
    expect(fileKind("a.DWG")).toBe("CAD");
    expect(fileKind("photo.jpeg")).toBe("Image");
    expect(fileKind("noext")).toBe("File");
  });
  it("encodes non-ASCII download names safely", () => {
    const h = contentDisposition('Lodge "Ndlovu" – plan.pdf');
    expect(h).toContain('filename="Lodge _Ndlovu_ _ plan.pdf"');
    expect(h).toContain("filename*=UTF-8''Lodge%20%22Ndlovu%22%20%E2%80%93%20plan.pdf");
  });
});

describe("upload tokens", () => {
  const secret = secretBytes("x".repeat(40));
  const claims = { typ: "upload" as const, pid: "p", fid: "f", uid: "u", key: "projects/p/docs/k.pdf", name: "a.pdf", size: 10, ct: "application/pdf" };

  it("round-trips valid claims", async () => {
    const t = await signToken(claims, secret, 60);
    expect(await verifyToken(t, uploadClaims, secret)).toEqual(claims);
  });
  it("rejects a token signed with another secret", async () => {
    const t = await signToken(claims, secretBytes("y".repeat(40)), 60);
    expect(await verifyToken(t, uploadClaims, secret)).toBeNull();
  });
  it("rejects a tampered token", async () => {
    const t = await signToken(claims, secret, 60);
    const [h, , s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, pid: "other" })).toString("base64url");
    expect(await verifyToken(`${h}.${forged}.${s}`, uploadClaims, secret)).toBeNull();
  });
  it("rejects an expired token", async () => {
    const t = await signToken(claims, secret, -10);
    expect(await verifyToken(t, uploadClaims, secret)).toBeNull();
  });
  it("won't accept a transfer token as an upload token", async () => {
    const t = await signToken({ typ: "transfer", op: "put", key: "k", max: 5 }, secret, 60);
    expect(await verifyToken(t, uploadClaims, secret)).toBeNull();
    expect(await verifyToken(t, transferClaims, secret)).toMatchObject({ op: "put", key: "k" });
  });
  it("requires a long secret", () => {
    expect(() => secretBytes("short")).toThrow();
  });
});
