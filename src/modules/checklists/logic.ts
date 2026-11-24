// Pure Checklists logic: item kinds, starter templates, access rules, answers,
// progress and the issue raised from a failed item. No database access, so it
// can be unit-tested.
import { z } from "zod";
import type { Level, MemberContext } from "@/lib/permissions";

export const checklistLabel = (n: number) => `CL-${n}`;

// ---------- item kinds ----------

export const ITEM_KINDS = ["YES_NO", "TEXT", "NUMBER", "DATE", "SIGNATURE", "PHOTO"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const KIND_LABELS: Record<ItemKind, string> = {
  YES_NO: "Yes / No / N/A",
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  SIGNATURE: "Signature",
  PHOTO: "Photo",
};

export const YES_NO = ["YES", "NO", "NA"] as const;
export type YesNo = (typeof YES_NO)[number];
export const YES_NO_LABELS: Record<YesNo, string> = { YES: "Yes", NO: "No", NA: "N/A" };

export type ChecklistStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
export const STATUS_LABELS: Record<ChecklistStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
};
export const STATUS_COLORS: Record<ChecklistStatus, string> = {
  NOT_STARTED: "#9ca3af",
  IN_PROGRESS: "#f59e0b",
  COMPLETED: "#16a34a",
};

// ---------- limits ----------

export const LIMITS = {
  sectionsPerTemplate: 30,
  itemsPerSection: 100,
  itemsPerTemplate: 300,
  templatesPerProject: 200,
  text: 2000,
  note: 1000,
  /** a signature is a small PNG drawn on a 480×160 pad */
  signatureBytes: 80 * 1024,
} as const;

// ---------- starter templates ----------

type StarterItem = [label: string, kind: ItemKind, required?: boolean];
export interface StarterTemplate {
  name: string;
  description: string;
  sections: { title: string; items: StarterItem[] }[];
}

/** Created in every project the first time it opens Checklists. Managers can edit or archive them. */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: "Villa handover snag list (luxury finishes)",
    description: "Room-by-room inspection of finishes before a villa or suite is handed to the operator.",
    sections: [
      {
        title: "Arrival and living areas",
        items: [
          ["Entrance door, ironmongery and locks operate smoothly", "YES_NO", true],
          ["Timber floors free of scratches, gaps and lifting", "YES_NO", true],
          ["Paintwork even, no runs, patches or roller marks", "YES_NO", true],
          ["Stone and feature walls clean, joints consistent", "YES_NO", true],
          ["Joinery doors and drawers aligned, soft-close working", "YES_NO", true],
          ["Lighting scenes and dimmers working", "YES_NO", true],
        ],
      },
      {
        title: "Bedroom and dressing",
        items: [
          ["Built-in cupboards complete, shelves level", "YES_NO", true],
          ["Curtain tracks and blackout blinds operate", "YES_NO", true],
          ["Air-conditioning quiet and reaching set point", "YES_NO", true],
          ["Mosquito screens fitted and undamaged", "YES_NO", true],
        ],
      },
      {
        title: "Bathroom",
        items: [
          ["Sanitaryware free of chips, sealant neat", "YES_NO", true],
          ["Hot water reaches outlets within 30 seconds", "YES_NO", true],
          ["Showers drain with no ponding", "YES_NO", true],
          ["Tiling grout consistent, no hollow tiles", "YES_NO", true],
          ["Brassware finish unmarked (no scratches or water spots)", "YES_NO", true],
        ],
      },
      {
        title: "Deck, plunge pool and exterior",
        items: [
          ["Deck boards fixed, oiled and splinter-free", "YES_NO", true],
          ["Balustrades secure and at height", "YES_NO", true],
          ["Outdoor shower and lighting working", "YES_NO", true],
          ["Photo of the completed villa", "PHOTO"],
        ],
      },
      {
        title: "Sign-off",
        items: [
          ["Snags found (number)", "NUMBER"],
          ["General comments", "TEXT"],
          ["Inspected by (signature)", "SIGNATURE", true],
        ],
      },
    ],
  },
  {
    name: "Thatch roof inspection",
    description: "Thatch quality, fire protection and lightning protection for thatched lodges and bomas.",
    sections: [
      {
        title: "Thatch",
        items: [
          ["Thatch thickness meets specification (mm)", "NUMBER", true],
          ["Even coursing, no thin spots or hollows", "YES_NO", true],
          ["Ridge capping sealed and secure", "YES_NO", true],
          ["Eaves trimmed straight, no gaps at walls", "YES_NO", true],
          ["Photo of the ridge and eaves", "PHOTO"],
        ],
      },
      {
        title: "Structure",
        items: [
          ["Poles and battens treated and free of borer", "YES_NO", true],
          ["Fixings and binding wire stainless or galvanised", "YES_NO", true],
          ["No sagging between purlins", "YES_NO", true],
        ],
      },
      {
        title: "Fire and lightning protection",
        items: [
          ["Fire retardant applied (date)", "DATE", true],
          ["Fire retardant certificate received", "YES_NO", true],
          ["Lightning mast installed at the required clearance", "YES_NO", true],
          ["Earthing tested and certificate received", "YES_NO", true],
          ["Fire extinguishers and hose reel in place", "YES_NO", true],
        ],
      },
      {
        title: "Sign-off",
        items: [
          ["Comments", "TEXT"],
          ["Inspector signature", "SIGNATURE", true],
        ],
      },
    ],
  },
  {
    name: "Pool commissioning",
    description: "Filling, water balance, plant room and safety checks before a pool is handed over.",
    sections: [
      {
        title: "Shell and finishes",
        items: [
          ["Shell inspected for cracks before filling", "YES_NO", true],
          ["Waterline tiles and coping complete", "YES_NO", true],
          ["Water level held for 48 hours (no leaks)", "YES_NO", true],
        ],
      },
      {
        title: "Plant room",
        items: [
          ["Pump primed and running without noise", "YES_NO", true],
          ["Filter backwashed and pressure recorded (kPa)", "NUMBER", true],
          ["Chlorinator or salt cell commissioned", "YES_NO", true],
          ["Heat pump or solar heating working", "YES_NO"],
          ["Electrical isolator labelled and earth-leakage tested", "YES_NO", true],
        ],
      },
      {
        title: "Water balance",
        items: [
          ["pH", "NUMBER", true],
          ["Free chlorine (ppm)", "NUMBER", true],
          ["Total alkalinity (ppm)", "NUMBER"],
          ["Water clear, floor visible from the deep end", "YES_NO", true],
        ],
      },
      {
        title: "Safety and handover",
        items: [
          ["Pool cover or safety net fitted", "YES_NO", true],
          ["Depth markings and signage in place", "YES_NO", true],
          ["Operator trained on the plant", "YES_NO", true],
          ["Commissioned on", "DATE", true],
          ["Photo of the plant room", "PHOTO"],
          ["Commissioning engineer signature", "SIGNATURE", true],
        ],
      },
    ],
  },
];

// ---------- access ----------

export interface ChecklistAccessFacts {
  createdById: string | null;
  assigneeType: "USER" | "ROLE" | "COMPANY" | null;
  assigneeId: string | null;
  status: ChecklistStatus;
}

export function isAssignedTo(member: Pick<MemberContext, "userId" | "companyId">, c: Pick<ChecklistAccessFacts, "assigneeType" | "assigneeId">) {
  if (!c.assigneeType || !c.assigneeId) return false;
  if (c.assigneeType === "USER") return c.assigneeId === member.userId;
  if (c.assigneeType === "COMPANY") return c.assigneeId === member.companyId;
  return false;
}

/**
 * Access rules (level = the member's effective Checklists level):
 * - see: Viewer and up
 * - create from a template: Creator and up
 * - edit details (title, assignee, location, due date): Managers, or Creators on their own checklists
 * - answer items and complete: anyone who may edit, plus the assignee (the user, or anyone in the company),
 *   while the checklist is not completed
 * - reopen a completed checklist: anyone who may edit
 * - delete: Managers
 * - build templates: Managers
 */
export function checklistAccess(level: Level, member: MemberContext, c: ChecklistAccessFacts) {
  const rank = ["NONE", "VIEWER", "CREATOR", "MANAGER"].indexOf(level);
  const see = rank >= 1;
  const manager = rank >= 3;
  const own = !!c.createdById && c.createdById === member.userId;
  const edit = see && (manager || (rank >= 2 && own));
  const open = c.status !== "COMPLETED";
  const answer = see && open && (edit || isAssignedTo(member, c));
  return { see, edit, answer, complete: answer, reopen: edit && !open, delete: manager };
}

/** Checklists go to a person or a company (not a role). */
export function parseChecklistAssignee(raw: string | null | undefined): { type: "USER" | "COMPANY"; id: string } | null {
  const m = /^(USER|COMPANY):([A-Za-z0-9_-]{1,64})$/.exec(raw ?? "");
  return m ? { type: m[1] as "USER" | "COMPANY", id: m[2] } : null;
}

// ---------- answers ----------

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^-?\d{1,12}(\.\d{1,6})?$/;
const PNG_PREFIX = "data:image/png;base64,";

/** Decoded byte length of a base64 string (without decoding it). */
export function base64Bytes(b64: string) {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** A signature is a PNG data URL within the size limit whose bytes start with the PNG signature. */
export function isSignature(value: string) {
  if (!value.startsWith(PNG_PREFIX)) return false;
  const b64 = value.slice(PNG_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) return false;
  if (base64Bytes(b64) > LIMITS.signatureBytes) return false;
  // "\x89PNG\r\n\x1a\n" encodes to "iVBORw0KGgo"
  return b64.startsWith("iVBORw0KGgo");
}

/**
 * Checks an answer for an item kind. A blank value clears the answer.
 * Photo items are answered by uploading photos, not through this.
 */
export function normaliseAnswer(kind: ItemKind, raw: string): { value: string | null } | { error: string } {
  const v = raw.trim();
  if (!v) return { value: null };
  switch (kind) {
    case "YES_NO":
      return (YES_NO as readonly string[]).includes(v) ? { value: v } : { error: "Choose Yes, No or N/A." };
    case "TEXT":
      return v.length <= LIMITS.text ? { value: v } : { error: `Keep answers under ${LIMITS.text} characters.` };
    case "NUMBER": {
      const n = v.replace(",", ".");
      return NUMBER.test(n) ? { value: n } : { error: "Enter a number." };
    }
    case "DATE":
      return DAY.test(v) && !Number.isNaN(Date.parse(v)) ? { value: v } : { error: "Enter a date." };
    case "SIGNATURE":
      return isSignature(v) ? { value: v } : { error: "Draw a signature first." };
    case "PHOTO":
      return { error: "Add a photo to answer this item." };
  }
}

export interface ItemState {
  kind: ItemKind;
  value: string | null;
  required: boolean;
  /** photos attached to the item (PHOTO items) */
  photoCount?: number;
}

export const isAnswered = (item: ItemState) => (item.kind === "PHOTO" ? (item.photoCount ?? 0) > 0 : !!item.value);
export const isFailed = (item: Pick<ItemState, "kind" | "value">) => item.kind === "YES_NO" && item.value === "NO";

/** Progress over all items, and the required items still unanswered. */
export function progress<T extends ItemState & { label: string }>(items: T[]) {
  const answered = items.filter(isAnswered).length;
  const missing = items.filter((i) => i.required && !isAnswered(i));
  return { answered, total: items.length, missing, failed: items.filter(isFailed).length, percent: items.length ? Math.round((answered / items.length) * 100) : 0 };
}

/** Status after an answer changes: a not-started checklist moves to In progress. */
export const statusAfterAnswer = (current: ChecklistStatus): ChecklistStatus => (current === "NOT_STARTED" ? "IN_PROGRESS" : current);

/** How an answer reads in the table and the PDF. */
export function answerText(item: Pick<ItemState, "kind" | "value" | "photoCount">): string {
  if (item.kind === "PHOTO") return item.photoCount ? `${item.photoCount} photo${item.photoCount === 1 ? "" : "s"}` : "";
  if (!item.value) return "";
  if (item.kind === "YES_NO") return YES_NO_LABELS[item.value as YesNo] ?? item.value;
  if (item.kind === "SIGNATURE") return "Signed";
  return item.value;
}

// ---------- raising an issue ----------

/** Title and description of the issue raised from a failed item. */
export function issueFromItem(c: { number: number; title: string }, section: string, item: { label: string; note: string | null }) {
  const suffix = ` (${checklistLabel(c.number)})`;
  const title = `${item.label.slice(0, 200 - suffix.length)}${suffix}`;
  const description = [`Failed on checklist ${checklistLabel(c.number)} "${c.title}", section "${section}".`, item.note ? `Note: ${item.note}` : ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 5000);
  return { title, description };
}

// ---------- ordering ----------

/** Moves one id up or down a list; returns null when it can't move. */
export function moveInList(ids: string[], id: string, dir: "up" | "down"): string[] | null {
  const i = ids.indexOf(id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// ---------- input ----------

const optionalId = z
  .string()
  .max(64)
  .transform((s) => s || null);

export const checklistDetailsSchema = z.object({
  title: z.string().trim().min(1, "Give the checklist a title").max(200, "Keep the title under 200 characters"),
  assignee: z.string().max(80),
  locationId: optionalId,
  dueDate: z
    .string()
    .refine((s) => !s || (DAY.test(s) && !Number.isNaN(Date.parse(s))), "Due date must be a date")
    .transform((s) => (s ? new Date(`${s}T00:00:00Z`) : null)),
});

export const templateItemSchema = z.object({
  label: z.string().trim().min(1, "Write the item").max(300, "Keep items under 300 characters"),
  kind: z.enum(ITEM_KINDS, { message: "Choose a kind of answer" }),
  required: z.boolean(),
});

export const templateNameSchema = z.string().trim().min(1, "Enter a name").max(120, "Keep names under 120 characters");
export const sectionTitleSchema = z.string().trim().min(1, "Enter a section title").max(120, "Keep section titles under 120 characters");

/** List filters from the URL. */
export function parseListFilters(params: Record<string, string | string[] | undefined>) {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const status = one("status");
  return {
    status: (["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "OPEN"].includes(status) ? status : "") as ChecklistStatus | "OPEN" | "",
    mine: one("mine") === "1",
    q: one("q").trim().slice(0, 100),
  };
}
