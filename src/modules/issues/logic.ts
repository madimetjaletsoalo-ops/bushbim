// Pure Issues logic: defaults, access rules, filters, dates, custom attributes and CSV rows.
// No database access, so it can be unit-tested.
import { z } from "zod";
import type { Level, MemberContext } from "@/lib/permissions";

export const issueLabel = (n: number) => `#${n}`;

// ---------- defaults ----------

/** ⭐ The default status set. Projects can rename, recolour, add and nest statuses. */
export const DEFAULT_STATUSES: { name: string; color: string; closed?: boolean; draft?: boolean; isDefault?: boolean }[] = [
  { name: "Draft", color: "#9ca3af", draft: true },
  { name: "Open", color: "#f59e0b", isDefault: true },
  { name: "Answered", color: "#0ea5e9" },
  { name: "Work completed", color: "#6366f1" },
  { name: "Ready to inspect", color: "#a855f7" },
  { name: "Not approved", color: "#dc2626" },
  { name: "In dispute", color: "#e11d48" },
  { name: "Closed", color: "#16a34a", closed: true },
  { name: "Void", color: "#57534e", closed: true },
];

export const DEFAULT_TYPES: { name: string; subtypes: string[] }[] = [
  { name: "Quality", subtypes: ["Defect", "Snag (luxury finishes)", "Damage"] },
  { name: "Safety", subtypes: ["Hazard", "Near miss", "PPE"] },
  { name: "Design", subtypes: ["Coordination", "Clarification"] },
  { name: "Commissioning", subtypes: ["Pool", "MEP", "Solar and backup power"] },
  { name: "Handover", subtypes: ["Snag list", "Warranty"] },
];

export const DEFAULT_ROOT_CAUSES = ["Design error", "Workmanship", "Material defect", "Coordination", "Weather", "Client change", "Unknown"];

// ---------- access ----------

/** The parts of an issue that decide who may see and change it. */
export interface IssueAccessFacts {
  createdById: string | null;
  assigneeType: "USER" | "ROLE" | "COMPANY" | null;
  assigneeId: string | null;
  draft: boolean;
}

export function isAssignedTo(member: Pick<MemberContext, "userId" | "roleIds" | "companyId">, issue: Pick<IssueAccessFacts, "assigneeType" | "assigneeId">) {
  if (!issue.assigneeType || !issue.assigneeId) return false;
  if (issue.assigneeType === "USER") return issue.assigneeId === member.userId;
  if (issue.assigneeType === "ROLE") return member.roleIds.includes(issue.assigneeId);
  return issue.assigneeId === member.companyId;
}

/**
 * Access rules (level = the member's effective Issues level):
 * - see: Viewer and up; draft issues only their creator and Managers
 * - create: Creator and up
 * - edit every field: Managers on any issue; Creators only on issues they created
 * - change status: anyone who may edit, plus the assignee (user, a member of the role, or the company)
 * - comment and watch: anyone who may see the issue
 * - configure types, statuses, root causes, attributes and locations: Managers
 */
export function issueAccess(level: Level, member: MemberContext, issue: IssueAccessFacts) {
  const rank = ["NONE", "VIEWER", "CREATOR", "MANAGER"].indexOf(level);
  const own = !!issue.createdById && issue.createdById === member.userId;
  const manager = rank >= 3;
  const see = rank >= 1 && (!issue.draft || own || manager);
  const edit = see && (manager || (rank >= 2 && own));
  const status = see && (edit || isAssignedTo(member, issue));
  return { see, edit, status, comment: see };
}

// ---------- statuses ----------

export interface StatusLite {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
  closed: boolean;
  draft: boolean;
  order: number;
}

/** Top-level statuses in order, each followed by its sub-statuses. */
export function orderStatuses<T extends StatusLite>(statuses: T[]): (T & { depth: 0 | 1 })[] {
  const byOrder = (a: T, b: T) => a.order - b.order || a.name.localeCompare(b.name);
  const tops = statuses.filter((s) => !s.parentId || !statuses.some((p) => p.id === s.parentId)).sort(byOrder);
  return tops.flatMap((t) => [{ ...t, depth: 0 as const }, ...statuses.filter((s) => s.parentId === t.id).sort(byOrder).map((s) => ({ ...s, depth: 1 as const }))]);
}

/** Choosing a status in the filter also matches its sub-statuses. */
export function expandStatusIds(selected: string[], statuses: Pick<StatusLite, "id" | "parentId">[]): string[] {
  const out = new Set(selected.filter((id) => statuses.some((s) => s.id === id)));
  for (const s of statuses) if (s.parentId && out.has(s.parentId)) out.add(s.id);
  return [...out];
}

/** A sub-status shows its own name after its parent's: "Open › Awaiting subcontractor". */
export function statusLabel(status: Pick<StatusLite, "name" | "parentId">, statuses: Pick<StatusLite, "id" | "name">[]) {
  const parent = status.parentId ? statuses.find((s) => s.id === status.parentId) : null;
  return parent ? `${parent.name} › ${status.name}` : status.name;
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// ---------- dates ----------

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Minutes the time zone is ahead of UTC at `at`. */
function tzOffsetMinutes(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** The instant a calendar day ("2026-11-23") starts in a time zone. */
export function zonedDayStart(day: string, timeZone: string): Date {
  if (!DAY.test(day)) throw new Error("Expected YYYY-MM-DD");
  const guess = new Date(`${day}T00:00:00Z`);
  const first = new Date(guess.getTime() - tzOffsetMinutes(guess, timeZone) * 60000);
  // second pass settles days where the offset changes (DST)
  return new Date(guess.getTime() - tzOffsetMinutes(first, timeZone) * 60000);
}

/** Today's date ("YYYY-MM-DD") in a time zone. */
export function todayIn(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Due dates are stored as UTC midnight of the calendar day. */
export const dueDay = (d: Date) => d.toISOString().slice(0, 10);

export function isOverdue(dueDate: Date | null, closed: boolean, timeZone: string, now = new Date()) {
  return !!dueDate && !closed && dueDay(dueDate) < todayIn(timeZone, now);
}

// ---------- custom attributes ----------

export type AttributeKind = "TEXT" | "NUMBER" | "DATE" | "LIST";
export interface AttributeDef {
  id: string;
  name: string;
  kind: AttributeKind;
  options: unknown;
}

export const listOptions = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);

/** Splits the options box of a LIST attribute (one per line or comma-separated). */
export function parseOptions(raw: string): string[] {
  return [...new Set(raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))].slice(0, 50).map((s) => s.slice(0, 60));
}

/**
 * Checks submitted custom attribute values against their definitions.
 * Blank values are dropped; returns the cleaned map or the first error.
 */
export function validateAttributes(defs: AttributeDef[], raw: Record<string, string | undefined>): { values: Record<string, string> } | { error: string } {
  const values: Record<string, string> = {};
  for (const d of defs) {
    const v = (raw[d.id] ?? "").trim();
    if (!v) continue;
    if (v.length > 500) return { error: `${d.name} is too long.` };
    if (d.kind === "NUMBER" && !/^-?\d+(\.\d+)?$/.test(v)) return { error: `${d.name} must be a number.` };
    if (d.kind === "DATE" && (!DAY.test(v) || Number.isNaN(Date.parse(v)))) return { error: `${d.name} must be a date.` };
    if (d.kind === "LIST" && !listOptions(d.options).includes(v)) return { error: `${d.name} must be one of its options.` };
    values[d.id] = v;
  }
  return { values };
}

// ---------- assignee ----------

export function parseAssignee(raw: string | null | undefined): { type: "USER" | "ROLE" | "COMPANY"; id: string } | null {
  const m = /^(USER|ROLE|COMPANY):([A-Za-z0-9_-]{1,64})$/.exec(raw ?? "");
  return m ? { type: m[1] as "USER" | "ROLE" | "COMPANY", id: m[2] } : null;
}

export const assigneeKey = (type: string | null, id: string | null) => (type && id ? `${type}:${id}` : "");

// ---------- create / edit input ----------

const optionalId = z
  .string()
  .max(64)
  .transform((s) => s || null);

export const issueSchema = z.object({
  title: z.string().trim().min(1, "Give the issue a title").max(200, "Keep the title under 200 characters"),
  description: z.string().trim().max(5000, "Keep the description under 5000 characters"),
  typeId: optionalId,
  subtypeId: optionalId,
  statusId: optionalId,
  assignee: z.string().max(80),
  dueDate: z
    .string()
    .refine((s) => !s || (DAY.test(s) && !Number.isNaN(Date.parse(s))), "Due date must be a date")
    .transform((s) => (s ? new Date(`${s}T00:00:00Z`) : null)),
  locationId: optionalId,
  rootCauseId: optionalId,
  watcherIds: z.array(z.string().min(1).max(64)).max(100),
});
export type IssueInput = z.infer<typeof issueSchema>;

/** Field names that differ between two issue snapshots, for the activity log. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : JSON.stringify(v ?? null));
  return Object.keys(after).filter((k) => norm(before[k]) !== norm(after[k]));
}

// ---------- filters ----------

export interface IssueFilters {
  q: string;
  typeIds: string[];
  statusIds: string[];
  createdById: string;
  assignee: string;
  createdFrom: string;
  createdTo: string;
  /** custom attribute filters: { [attributeId]: value } */
  attrs: Record<string, string>;
}

type Params = Record<string, string | string[] | undefined>;
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter((x) => x && x.length <= 64).slice(0, 50);
const one = (v: string | string[] | undefined, max = 200) => (Array.isArray(v) ? v[0] ?? "" : v ?? "").slice(0, max);

/** Reads the filter panel from the URL. Custom attributes arrive as `a_<attributeId>`. */
export function parseFilters(params: Params): IssueFilters {
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!k.startsWith("a_") || k.length > 70) continue;
    const value = one(v).trim();
    if (value) attrs[k.slice(2)] = value;
  }
  const day = (v: string | string[] | undefined) => {
    const s = one(v, 10);
    return DAY.test(s) && !Number.isNaN(Date.parse(s)) ? s : "";
  };
  return {
    q: one(params.q).trim(),
    typeIds: many(params.type),
    statusIds: many(params.status),
    createdById: one(params.createdBy, 64),
    assignee: parseAssignee(one(params.assignee, 80)) ? one(params.assignee, 80) : "",
    createdFrom: day(params.from),
    createdTo: day(params.to),
    attrs,
  };
}

export const activeFilterCount = (f: IssueFilters) =>
  [f.q, f.typeIds.length, f.statusIds.length, f.createdById, f.assignee, f.createdFrom, f.createdTo].filter(Boolean).length + Object.keys(f.attrs).length;

/** Turns filters back into a query string, e.g. for the CSV export link. */
export function filterQuery(f: IssueFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  f.typeIds.forEach((t) => p.append("type", t));
  f.statusIds.forEach((s) => p.append("status", s));
  if (f.createdById) p.set("createdBy", f.createdById);
  if (f.assignee) p.set("assignee", f.assignee);
  if (f.createdFrom) p.set("from", f.createdFrom);
  if (f.createdTo) p.set("to", f.createdTo);
  for (const [k, v] of Object.entries(f.attrs)) p.set(`a_${k}`, v);
  return p.toString();
}

/**
 * The Prisma `where` for a filtered issue list (as a plain object so it stays testable).
 * `visibility` limits drafts to their creator unless the viewer is a Manager.
 */
export function buildIssueWhere(
  projectId: string,
  f: IssueFilters,
  ctx: { statuses: Pick<StatusLite, "id" | "parentId">[]; attributes: Pick<AttributeDef, "id" | "kind">[]; timeZone: string; userId: string; manager: boolean },
) {
  const and: Record<string, unknown>[] = [];
  if (!ctx.manager) and.push({ OR: [{ status: { draft: false } }, { createdById: ctx.userId }] });
  if (f.q) {
    const n = /^#?(\d{1,9})$/.exec(f.q);
    and.push({
      OR: [
        { title: { contains: f.q, mode: "insensitive" } },
        { description: { contains: f.q, mode: "insensitive" } },
        ...(n ? [{ number: Number(n[1]) }] : []),
      ],
    });
  }
  if (f.typeIds.length) and.push({ typeId: { in: f.typeIds } });
  if (f.statusIds.length) and.push({ statusId: { in: expandStatusIds(f.statusIds, ctx.statuses) } });
  if (f.createdById) and.push({ createdById: f.createdById });
  const a = parseAssignee(f.assignee);
  if (a) and.push({ assigneeType: a.type, assigneeId: a.id });
  if (f.createdFrom) and.push({ createdAt: { gte: zonedDayStart(f.createdFrom, ctx.timeZone) } });
  if (f.createdTo) {
    const next = new Date(`${f.createdTo}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    and.push({ createdAt: { lt: zonedDayStart(next.toISOString().slice(0, 10), ctx.timeZone) } });
  }
  for (const [id, value] of Object.entries(f.attrs)) {
    const def = ctx.attributes.find((d) => d.id === id);
    if (!def) continue;
    and.push(def.kind === "TEXT" ? { attributes: { path: [id], string_contains: value } } : { attributes: { path: [id], equals: value } });
  }
  return { projectId, AND: and };
}

// ---------- CSV ----------

export const CSV_HEADER = ["ID", "Title", "Type", "Subtype", "Status", "Assignee", "Due date", "Location", "Root cause", "Created by", "Created", "Description"];

/** Escapes one CSV cell, and defuses values a spreadsheet would run as a formula. */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  description: "description",
  typeId: "type",
  subtypeId: "subtype",
  assigneeType: "assignee",
  assigneeId: "assignee",
  dueDate: "due date",
  locationId: "location",
  rootCauseId: "root cause",
  attributes: "custom attributes",
  watchers: "watchers",
};

/** Readable, de-duplicated names for changed fields: ["assigneeType", "assigneeId"] → ["assignee"]. */
export const fieldLabels = (fields: string[]) => [...new Set(fields.map((f) => FIELD_LABELS[f] ?? f))];
