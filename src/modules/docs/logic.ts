// Pure Document Control helpers: names, sorting, folder tree and storage keys.
// No database or framework imports, so everything here is unit tested.

export const ROOTS = [
  { root: "PLANS", name: "Plans" },
  { root: "PROJECT_FILES", name: "Project Files" },
] as const;
export type RootKey = (typeof ROOTS)[number]["root"];

/** Largest single upload. Kept within a 32-bit Int column and sane for site connections. */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 50;
export const MAX_NAME_LENGTH = 200;

// Characters that break paths or downloads on common operating systems.
const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;

/** Validates a folder or file name. Returns the cleaned name, or an error message. */
export function checkName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Name can't be empty." };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  if (BAD_CHARS.test(name)) return { ok: false, error: 'Name can\'t contain \\ / : * ? " < > |' };
  if (name === "." || name === "..") return { ok: false, error: "That name isn't allowed." };
  return { ok: true, name };
}

/** Case-insensitive key: uploads that differ only in case stack as one document. */
export const nameKey = (name: string) => name.normalize("NFC").trim().toLowerCase();

export type SortKey = "name" | "date" | "size";
export type SortDir = "asc" | "desc";

export function parseSort(sort?: string, dir?: string): { sort: SortKey; dir: SortDir } {
  const s: SortKey = sort === "date" || sort === "size" ? sort : "name";
  const d: SortDir = dir === "desc" || dir === "asc" ? dir : s === "name" ? "asc" : "desc";
  return { sort: s, dir: d };
}

export interface Sortable {
  name: string;
  updatedAt: Date;
  size: number;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Sorts files; ties fall back to name so the order is stable. "A-102" sorts before "A-1010". */
export function sortItems<T extends Sortable>(items: T[], sort: SortKey, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    let c = 0;
    if (sort === "date") c = a.updatedAt.getTime() - b.updatedAt.getTime();
    else if (sort === "size") c = a.size - b.size;
    if (c === 0) c = collator.compare(a.name, b.name);
    return c * sign;
  });
}

export const sortFolderNames = <T extends { name: string }>(folders: T[]) =>
  [...folders].sort((a, b) => collator.compare(a.name, b.name));

export interface FlatFolder {
  id: string;
  parentId: string | null;
  name: string;
  root: RootKey | null;
}

export interface TreeNode extends FlatFolder {
  children: TreeNode[];
}

/** Builds the folder tree. Roots come first in the fixed order Plans, Project Files. */
export function buildTree(folders: FlatFolder[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const f of folders) byId.set(f.id, { ...f, children: [] });
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else if (!node.parentId) roots.push(node);
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => collator.compare(a.name, b.name));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  const order = (n: TreeNode) => (n.root ? ROOTS.findIndex((r) => r.root === n.root) : ROOTS.length);
  roots.sort((a, b) => order(a) - order(b));
  return roots;
}

/** Path from the root to the given folder, inclusive. Empty if unknown. */
export function ancestors<T extends { id: string; parentId: string | null }>(folders: T[], id: string): T[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: T[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/** The folder and all folders below it. */
export function subtreeIds(folders: { id: string; parentId: string | null }[], id: string): string[] {
  const kids = new Map<string, string[]>();
  for (const f of folders) if (f.parentId) kids.set(f.parentId, [...(kids.get(f.parentId) ?? []), f.id]);
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.includes(cur)) continue;
    out.push(cur);
    stack.push(...(kids.get(cur) ?? []));
  }
  return out;
}

/** Object key for an upload. Random part keeps keys unguessable and unique per version. */
export function storageKey(projectId: string, fileName: string, random: string): string {
  const ext = /\.([a-z0-9]{1,10})$/i.exec(fileName)?.[1]?.toLowerCase();
  return `projects/${projectId}/docs/${random}${ext ? `.${ext}` : ""}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Short type label for the file list, from the extension. */
export function fileKind(name: string): string {
  const ext = /\.([a-z0-9]{1,10})$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext) return "File";
  if (ext === "pdf") return "PDF";
  if (["dwg", "dxf"].includes(ext)) return "CAD";
  if (["rvt", "ifc", "nwd", "nwc"].includes(ext)) return "Model";
  if (["jpg", "jpeg", "png", "webp", "heic", "gif"].includes(ext)) return "Image";
  if (["doc", "docx"].includes(ext)) return "Word";
  if (["xls", "xlsx", "csv"].includes(ext)) return "Sheet";
  if (["zip", "7z", "rar"].includes(ext)) return "Archive";
  return ext.toUpperCase();
}

/** Safe Content-Disposition header for a download (RFC 6266 with UTF-8 fallback). */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Turns a version number into its label, e.g. 3 → "V3". */
export const versionLabel = (n: number) => `V${n}`;
