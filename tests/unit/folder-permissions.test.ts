import { describe, expect, it } from "vitest";
import type { Grant, MemberContext } from "@/lib/permissions";
import {
  accessReport,
  buildIndex,
  folderLevel,
  levelAtLeast,
  visibleFolders,
  type FolderGrant,
  type FolderNode,
} from "@/modules/docs/folder-permissions";

// Project Files ─ Commercial ─ Valuations ─ Final
//              └ Photos
// Plans
const folders: FolderNode[] = [
  { id: "plans", parentId: null, name: "Plans" },
  { id: "pf", parentId: null, name: "Project Files" },
  { id: "com", parentId: "pf", name: "Commercial" },
  { id: "val", parentId: "com", name: "Valuations" },
  { id: "fin", parentId: "val", name: "Final" },
  { id: "pho", parentId: "pf", name: "Photos" },
];

const member = (o: Partial<MemberContext> = {}): MemberContext => ({
  userId: "u1",
  accessLevel: "MEMBER",
  companyId: "qs",
  roleIds: ["r-site"],
  services: ["DOCS"],
  ...o,
});
const g = (folderId: string, subjectType: FolderGrant["subjectType"], subjectId: string, level: FolderGrant["level"]): FolderGrant => ({
  folderId,
  subjectType,
  subjectId,
  level,
});
const creator: Grant[] = [{ service: "DOCS", subjectType: "USER", subjectId: "u1", level: "CREATOR" }];
const docsManager: Grant[] = [{ service: "DOCS", subjectType: "USER", subjectId: "u1", level: "MANAGER" }];
const level = (m: MemberContext, grants: FolderGrant[], id: string, svc: Grant[] = []) => folderLevel(m, svc, buildIndex(folders, grants), id);

// Commercial is private: members get nothing, the QS company gets View + Download
const privateCommercial = [g("com", "DEFAULT", "*", "NONE"), g("com", "COMPANY", "qs", "VIEW_DOWNLOAD")];

describe("folderLevel defaults", () => {
  it("gives Viewers View + Download and Creators Edit everywhere when no folder grants exist", () => {
    expect(level(member(), [], "fin")).toBe("VIEW_DOWNLOAD");
    expect(level(member(), [], "fin", creator)).toBe("EDIT");
  });
  it("gives NONE without Document Control enabled, even with folder grants", () => {
    expect(level(member({ services: ["ISSUES"] }), [g("pf", "USER", "u1", "MANAGE")], "pf")).toBe("NONE");
  });
  it("gives project admins, account admins and Document Control managers Manage even on private folders", () => {
    expect(level(member({ accessLevel: "PROJECT_ADMIN", companyId: "other" }), privateCommercial, "com")).toBe("MANAGE");
    expect(level(member({ isAccountAdmin: true, companyId: "other" }), privateCommercial, "fin")).toBe("MANAGE");
    expect(level(member({ companyId: "other" }), privateCommercial, "val", docsManager)).toBe("MANAGE");
  });
  it("returns NONE for unknown folders", () => {
    expect(level(member({ accessLevel: "PROJECT_ADMIN" }), [], "nope")).toBe("NONE");
  });
});

describe("inheritance and overrides", () => {
  it("makes a folder and its subfolders private while the granted company keeps access", () => {
    const outsider = member({ companyId: "mep", roleIds: [] });
    for (const id of ["com", "val", "fin"]) {
      expect(level(outsider, privateCommercial, id)).toBe("NONE");
      expect(level(member(), privateCommercial, id)).toBe("VIEW_DOWNLOAD");
    }
    // siblings and parents are unaffected
    expect(level(outsider, privateCommercial, "pho")).toBe("VIEW_DOWNLOAD");
    expect(level(outsider, privateCommercial, "pf")).toBe("VIEW_DOWNLOAD");
  });
  it("lets a subfolder override a subject's inherited level, up or down", () => {
    const up = [...privateCommercial, g("val", "COMPANY", "qs", "UPLOAD")];
    expect(level(member(), up, "val")).toBe("UPLOAD");
    expect(level(member(), up, "fin")).toBe("UPLOAD");
    expect(level(member(), up, "com")).toBe("VIEW_DOWNLOAD");
    const down = [...privateCommercial, g("fin", "COMPANY", "qs", "VIEW")];
    expect(level(member(), down, "fin")).toBe("VIEW");
  });
  it("lets a subfolder reopen a private parent to all members", () => {
    const reopened = [...privateCommercial, g("fin", "DEFAULT", "*", "VIEW")];
    expect(level(member({ companyId: "mep", roleIds: [] }), reopened, "fin")).toBe("VIEW");
  });
  it("can lower the default for everyone, below the service level", () => {
    expect(level(member(), [g("plans", "DEFAULT", "*", "VIEW")], "plans", creator)).toBe("VIEW");
  });
  it("takes the highest of the default, user, role and company levels", () => {
    const grants = [
      g("com", "DEFAULT", "*", "NONE"),
      g("com", "USER", "u1", "VIEW"),
      g("com", "ROLE", "r-site", "UPLOAD"),
      g("com", "COMPANY", "qs", "VIEW_DOWNLOAD"),
    ];
    expect(level(member(), grants, "com")).toBe("UPLOAD");
    expect(level(member({ roleIds: [] }), grants, "com")).toBe("VIEW_DOWNLOAD");
  });
  it("lets an explicit NONE for the user be outweighed by their company (highest wins)", () => {
    expect(level(member(), [g("com", "USER", "u1", "NONE")], "com")).toBe("VIEW_DOWNLOAD");
  });
});

describe("levelAtLeast", () => {
  it("orders the levels", () => {
    expect(levelAtLeast("EDIT", "UPLOAD")).toBe(true);
    expect(levelAtLeast("VIEW", "VIEW_DOWNLOAD")).toBe(false);
    expect(levelAtLeast("NONE", "VIEW")).toBe(false);
    expect(levelAtLeast("MANAGE", "MANAGE")).toBe(true);
  });
});

describe("visibleFolders", () => {
  it("shows the path to a subfolder shared on its own, without making the path openable", () => {
    const grants = [g("pf", "DEFAULT", "*", "NONE"), g("val", "COMPANY", "qs", "VIEW")];
    const { visible, openable } = visibleFolders(member(), [], buildIndex(folders, grants));
    expect([...openable].sort()).toEqual(["fin", "plans", "val"]);
    expect([...visible].sort()).toEqual(["com", "fin", "pf", "plans", "val"]);
  });
  it("hides everything without Document Control", () => {
    const { visible } = visibleFolders(member({ services: [] }), [], buildIndex(folders, []));
    expect(visible.size).toBe(0);
  });
});

describe("accessReport", () => {
  it("lists grants set here and inherited ones, nearest winning, default first", () => {
    const grants = [...privateCommercial, g("val", "COMPANY", "qs", "UPLOAD"), g("fin", "USER", "u9", "MANAGE")];
    const rows = accessReport(buildIndex(folders, grants), "fin");
    expect(rows.map((r) => [r.subjectType, r.subjectId, r.level, r.inheritedFrom?.name ?? "here"])).toEqual([
      ["DEFAULT", "*", "NONE", "Commercial"],
      ["USER", "u9", "MANAGE", "here"],
      ["COMPANY", "qs", "UPLOAD", "Valuations"],
    ]);
  });
  it("is empty for a folder with no grants above it", () => {
    expect(accessReport(buildIndex(folders, privateCommercial), "pho")).toEqual([]);
  });
});
