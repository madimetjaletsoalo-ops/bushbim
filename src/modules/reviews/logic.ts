// Reviews and approval workflows: pure logic, unit tested (tests/unit/reviews.test.ts).
//
// - A workflow has 1–5 steps. Each step names its reviewers (users, roles or
//   companies) and whether ANY one of them or ALL of them must respond.
// - A reviewer decides on every file in the review. A step's result for a file
//   is the worst decision it received at that step.
// - When the last step completes, the review closes and each file keeps the
//   last step's result as its outcome.
import { z } from "zod";
import type { MemberContext } from "@/lib/permissions";

export const OUTCOMES = ["APPROVED", "APPROVED_WITH_COMMENTS", "REVISE_RESUBMIT", "REJECTED"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  APPROVED: "Approved",
  APPROVED_WITH_COMMENTS: "Approved with comments",
  REVISE_RESUBMIT: "Revise & resubmit",
  REJECTED: "Rejected",
};

export const OUTCOME_BADGE: Record<Outcome, string> = {
  APPROVED: "bg-emerald-100 text-emerald-900",
  APPROVED_WITH_COMMENTS: "bg-lime-100 text-lime-900",
  REVISE_RESUBMIT: "bg-amber-100 text-amber-900",
  REJECTED: "bg-red-100 text-red-800",
};

export const isApproved = (o: Outcome | null | undefined) => o === "APPROVED" || o === "APPROVED_WITH_COMMENTS";

export const MAX_STEPS = 5;
export const MAX_FILES_PER_REVIEW = 100;

export interface StatusOption {
  code: Outcome;
  label: string;
}

export const DEFAULT_STATUSES: StatusOption[] = OUTCOMES.map((code) => ({ code, label: OUTCOME_LABELS[code] }));

export const statusesSchema = z
  .array(z.object({ code: z.enum(OUTCOMES), label: z.string().trim().min(1).max(60) }))
  .min(1)
  .max(OUTCOMES.length);

/** The workflow's statuses, falling back to the defaults if the stored value is unusable. */
export function parseStatuses(raw: unknown): StatusOption[] {
  const p = statusesSchema.safeParse(raw);
  return p.success ? p.data : DEFAULT_STATUSES;
}

export const labelFor = (statuses: StatusOption[], code: Outcome) => statuses.find((s) => s.code === code)?.label ?? OUTCOME_LABELS[code];

/** The worse of two outcomes (Rejected is the worst). */
export const worse = (a: Outcome, b: Outcome): Outcome => (OUTCOMES.indexOf(a) >= OUTCOMES.indexOf(b) ? a : b);
export const worst = (list: Outcome[]): Outcome | null => (list.length ? list.reduce(worse) : null);

// ---------- subjects ("USER:id", "ROLE:id", "COMPANY:id") ----------

export const subjectSchema = z.string().regex(/^(USER|ROLE|COMPANY):[\w-]{1,64}$/, "Invalid person, role or company");
export const subjectsSchema = z.array(subjectSchema).max(100);

export function parseSubjects(raw: unknown): string[] {
  const p = subjectsSchema.safeParse(raw);
  return p.success ? p.data : [];
}

/** True if the member is one of the subjects (their user, one of their roles, or their company). */
export function matchesSubject(member: Pick<MemberContext, "userId" | "roleIds" | "companyId">, subjects: string[]): boolean {
  return subjects.some((s) => {
    const [type, ...rest] = s.split(":");
    const id = rest.join(":");
    if (type === "USER") return id === member.userId;
    if (type === "ROLE") return member.roleIds.includes(id);
    if (type === "COMPANY") return !!member.companyId && id === member.companyId;
    return false;
  });
}

// ---------- step progress ----------

export interface StepDef {
  order: number;
  name: string;
  reviewers: string[];
  mode: "ANY" | "ALL";
  days: number;
}

export interface Decision {
  reviewerId: string;
  documentId: string;
  outcome: Outcome;
}

/** Reviewers who have decided on every file of the review at this step. */
export function finishedReviewers(decisions: Decision[], documentIds: string[]): Set<string> {
  const byReviewer = new Map<string, Set<string>>();
  for (const d of decisions) byReviewer.set(d.reviewerId, (byReviewer.get(d.reviewerId) ?? new Set()).add(d.documentId));
  const done = new Set<string>();
  for (const [r, docs] of byReviewer) if (documentIds.every((id) => docs.has(id))) done.add(r);
  return done;
}

/**
 * Whether a step is complete. `eligible` is the user ids who can review this step now.
 * ANY: one finished reviewer. ALL: every eligible reviewer has finished (reviewers who
 * finished but have since lost access still count).
 */
export function stepComplete(mode: "ANY" | "ALL", decisions: Decision[], documentIds: string[], eligible: string[]): boolean {
  const done = finishedReviewers(decisions, documentIds);
  if (done.size === 0) return false;
  if (mode === "ANY") return true;
  return eligible.every((u) => done.has(u));
}

/** Each file's result at a step: the worst decision among finished reviewers. */
export function stepResults(decisions: Decision[], documentIds: string[]): Map<string, Outcome> {
  const done = finishedReviewers(decisions, documentIds);
  const out = new Map<string, Outcome>();
  for (const id of documentIds) {
    const w = worst(decisions.filter((d) => d.documentId === id && done.has(d.reviewerId)).map((d) => d.outcome));
    if (w) out.set(id, w);
  }
  return out;
}

export const dueDate = (from: Date, days: number) => new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

// ---------- workflow form ----------

const stepSchema = z.object({
  name: z.string().trim().min(1, "Each step needs a name").max(100),
  reviewers: subjectsSchema.min(1, "Each step needs at least one reviewer"),
  mode: z.enum(["ANY", "ALL"]),
  days: z.coerce.number().int().min(1, "Days must be 1–60").max(60, "Days must be 1–60"),
});

export const workflowSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(500).optional(),
  statuses: statusesSchema,
  initiators: subjectsSchema,
  steps: z.array(stepSchema).min(1, "Add at least one step").max(MAX_STEPS),
  autoStartFolderId: z.string().max(64).nullable(),
  approvedFolderId: z.string().max(64).nullable(),
});
export type WorkflowInput = z.infer<typeof workflowSchema>;

/** Reads the workflow builder form (fields step{n}Name, step{n}Reviewers, status_{CODE}…). */
export function readWorkflowForm(form: FormData): unknown {
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  const steps: unknown[] = [];
  for (let n = 1; n <= MAX_STEPS; n++) {
    const name = str(`step${n}Name`).trim();
    const reviewers = form.getAll(`step${n}Reviewers`).filter((x): x is string => typeof x === "string" && !!x);
    // an untouched step (no name, no reviewers) is skipped; anything later must follow on
    if (!name && reviewers.length === 0) continue;
    steps.push({ name, reviewers, mode: str(`step${n}Mode`) || "ANY", days: str(`step${n}Days`) || "5" });
  }
  const statuses = OUTCOMES.filter((c) => form.get(`status_${c}`) === "on").map((code) => ({
    code,
    label: str(`label_${code}`).trim() || OUTCOME_LABELS[code],
  }));
  return {
    name: str("name"),
    description: str("description") || undefined,
    statuses,
    initiators: form.getAll("initiators").filter((x): x is string => typeof x === "string" && !!x),
    steps,
    autoStartFolderId: str("autoStartFolderId") || null,
    approvedFolderId: str("approvedFolderId") || null,
  };
}

// ---------- search ----------

/** Splits a search box value into lower-cased terms; "#12" also matches review number 12. */
export function searchTerms(q: string | undefined): string[] {
  return (q ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** True if every term appears in one of the review's searchable texts (or is its #number). */
export function matchesSearch(terms: string[], number: number, texts: (string | null | undefined)[]): boolean {
  const hay = texts.filter(Boolean).join("\n").toLowerCase();
  return terms.every((t) => t === `#${number}` || t === String(number) || hay.includes(t));
}
