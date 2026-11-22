// Folder-level permissions for Document Control. Pure logic, unit tested.
//
// Rules:
// - Project admins, account admins and Document Control Managers have MANAGE everywhere.
// - Members without Document Control enabled have NONE.
// - Otherwise, for each subject that applies to the member (their user, each role,
//   their company) the grant on the nearest folder walking up to the root decides
//   that subject's level (it may be NONE). The "project members" default works the
//   same way, falling back to the service level (Viewer → View+Download,
//   Creator → Edit) when no folder sets it. The highest level wins.
import { effectiveLevel, type Grant, type MemberContext } from "@/lib/permissions";

export const FOLDER_LEVELS = ["NONE", "VIEW", "VIEW_DOWNLOAD", "UPLOAD", "EDIT", "MANAGE"] as const;
export type FolderLevel = (typeof FOLDER_LEVELS)[number];

export const FOLDER_LEVEL_LABELS: Record<FolderLevel, string> = {
  NONE: "No access",
  VIEW: "View",
  VIEW_DOWNLOAD: "View + Download",
  UPLOAD: "Upload",
  EDIT: "Edit",
  MANAGE: "Manage",
};

export const FOLDER_LEVEL_HELP: Record<FolderLevel, string> = {
  NONE: "Can't see the folder",
  VIEW: "See files and versions, no download",
  VIEW_DOWNLOAD: "See and download",
  UPLOAD: "Also upload files and new versions",
  EDIT: "Also create subfolders",
  MANAGE: "Also rename, delete and change permissions",
};

export type FolderSubjectType = "DEFAULT" | "USER" | "ROLE" | "COMPANY";
export const DEFAULT_SUBJECT_ID = "*";

export interface FolderGrant {
  folderId: string;
  subjectType: FolderSubjectType;
  subjectId: string;
  level: FolderLevel;
}

export interface FolderNode {
  id: string;
  parentId: string | null;
  name: string;
}

const rankOf = (l: FolderLevel) => FOLDER_LEVELS.indexOf(l);
export const levelAtLeast = (have: FolderLevel, need: FolderLevel) => rankOf(have) >= rankOf(need);
const maxOf = (a: FolderLevel, b: FolderLevel): FolderLevel => (rankOf(a) >= rankOf(b) ? a : b);

/** Everything the resolver needs about one project, prepared once per request. */
export interface FolderIndex {
  byId: Map<string, FolderNode>;
  /** folderId → grants set on that folder */
  grants: Map<string, FolderGrant[]>;
}

export function buildIndex(folders: FolderNode[], grants: FolderGrant[]): FolderIndex {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const map = new Map<string, FolderGrant[]>();
  for (const g of grants) map.set(g.folderId, [...(map.get(g.folderId) ?? []), g]);
  return { byId, grants: map };
}

/** Folder ids from `id` up to its root, nearest first. Cycle-safe. */
export function pathUp(index: FolderIndex, id: string): string[] {
  const out: string[] = [];
  let cur = index.byId.get(id);
  while (cur && !out.includes(cur.id)) {
    out.push(cur.id);
    cur = cur.parentId ? index.byId.get(cur.parentId) : undefined;
  }
  return out;
}

const subjectKey = (t: FolderSubjectType, id: string) => `${t}:${id}`;

/** For one subject: the nearest grant on the path, and the folder it was set on. */
function nearest(index: FolderIndex, path: string[], type: FolderSubjectType, id: string) {
  for (const fid of path) {
    const g = index.grants.get(fid)?.find((x) => x.subjectType === type && x.subjectId === id);
    if (g) return g;
  }
  return null;
}

/** Members whose access can't be narrowed by folder grants. */
export function alwaysManages(member: MemberContext, serviceGrants: Grant[]): boolean {
  return effectiveLevel(member, "DOCS", serviceGrants) === "MANAGER";
}

/** Project-wide default before any folder grant: from the Document Control service level. */
export function serviceDefault(member: MemberContext, serviceGrants: Grant[]): FolderLevel {
  const l = effectiveLevel(member, "DOCS", serviceGrants);
  return l === "MANAGER" ? "MANAGE" : l === "CREATOR" ? "EDIT" : l === "VIEWER" ? "VIEW_DOWNLOAD" : "NONE";
}

/** A member's effective level on a folder. Unknown folders give NONE. */
export function folderLevel(member: MemberContext, serviceGrants: Grant[], index: FolderIndex, folderId: string): FolderLevel {
  if (!index.byId.has(folderId)) return "NONE";
  if (alwaysManages(member, serviceGrants)) return "MANAGE";
  const base = serviceDefault(member, serviceGrants);
  if (base === "NONE") return "NONE"; // Document Control not enabled
  const path = pathUp(index, folderId);
  let level: FolderLevel = nearest(index, path, "DEFAULT", DEFAULT_SUBJECT_ID)?.level ?? base;
  const subjects: [FolderSubjectType, string][] = [
    ["USER", member.userId],
    ...member.roleIds.map((r): [FolderSubjectType, string] => ["ROLE", r]),
    ...(member.companyId ? [["COMPANY", member.companyId] as [FolderSubjectType, string]] : []),
  ];
  for (const [t, id] of subjects) {
    const g = nearest(index, path, t, id);
    if (g) level = maxOf(level, g.level);
  }
  return level;
}

/**
 * Folders to show in the tree: those the member can VIEW, plus their ancestors
 * (so a subfolder shared on its own is still reachable). `openable` marks the
 * ones the member may actually open.
 */
export function visibleFolders(member: MemberContext, serviceGrants: Grant[], index: FolderIndex) {
  const openable = new Set<string>();
  const visible = new Set<string>();
  for (const id of index.byId.keys()) {
    if (!levelAtLeast(folderLevel(member, serviceGrants, index, id), "VIEW")) continue;
    openable.add(id);
    for (const a of pathUp(index, id)) visible.add(a);
  }
  return { visible, openable };
}

export interface ReportRow {
  subjectType: FolderSubjectType;
  subjectId: string;
  level: FolderLevel;
  /** null when set on this folder; otherwise the folder it's inherited from */
  inheritedFrom: { id: string; name: string } | null;
}

/** Every subject with a grant on this folder or inherited from above, nearest wins. */
export function accessReport(index: FolderIndex, folderId: string): ReportRow[] {
  const seen = new Set<string>();
  const rows: ReportRow[] = [];
  for (const fid of pathUp(index, folderId)) {
    for (const g of index.grants.get(fid) ?? []) {
      const k = subjectKey(g.subjectType, g.subjectId);
      if (seen.has(k)) continue;
      seen.add(k);
      const from = fid === folderId ? null : { id: fid, name: index.byId.get(fid)?.name ?? "" };
      rows.push({ subjectType: g.subjectType, subjectId: g.subjectId, level: g.level, inheritedFrom: from });
    }
  }
  const order: Record<FolderSubjectType, number> = { DEFAULT: 0, USER: 1, ROLE: 2, COMPANY: 3 };
  return rows.sort((a, b) => order[a.subjectType] - order[b.subjectType]);
}
