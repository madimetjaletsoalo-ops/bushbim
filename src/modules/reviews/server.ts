import "server-only";
import { after } from "next/server";
import { queueVersion, runIndexJobs } from "@/modules/search/indexer";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { effectiveLevel, rank, type MemberContext, type ServiceKey } from "@/lib/permissions";
import { getDocsContext } from "@/modules/docs/access";
import { levelAtLeast } from "@/modules/docs/folder-permissions";
import { nameKey, storageKey, versionLabel } from "@/modules/docs/logic";
import { syncSheetsForVersion } from "@/modules/docs/sheets-server";
import {
  dueDate,
  isApproved,
  matchesSubject,
  parseSubjects,
  stepComplete,
  stepResults,
  type Decision,
  type Outcome,
  type StepDef,
} from "./logic";

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export type ProjectMemberCtx = MemberContext & { name: string };

/** Every project member as a permission context, for working out who can review a step. */
export async function projectMembers(projectId: string): Promise<ProjectMemberCtx[]> {
  const rows = await db.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { name: true, accountRole: true } }, roles: { select: { roleId: true } } },
  });
  return rows.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    accessLevel: m.accessLevel,
    isAccountAdmin: m.user.accountRole === "ACCOUNT_ADMIN",
    companyId: m.companyId,
    roleIds: m.roles.map((r) => r.roleId),
    services: m.services as ServiceKey[],
  }));
}

export const toStepDef = (s: { order: number; name: string; reviewers: unknown; mode: "ANY" | "ALL"; days: number }): StepDef => ({
  order: s.order,
  name: s.name,
  reviewers: parseSubjects(s.reviewers),
  mode: s.mode,
  days: s.days,
});

/** Members who can review a step: named by the step (user, role or company) and able to open Document Control. */
export function eligibleReviewers(members: ProjectMemberCtx[], grants: Parameters<typeof effectiveLevel>[2], step: StepDef) {
  return members.filter((m) => matchesSubject(m, step.reviewers) && rank(effectiveLevel(m, "DOCS", grants)) >= rank("VIEWER"));
}

/** True if the member may start reviews with this workflow. */
export function canInitiate(member: MemberContext, grants: Parameters<typeof effectiveLevel>[2], initiators: unknown) {
  const level = effectiveLevel(member, "DOCS", grants);
  if (level === "MANAGER") return true;
  const list = parseSubjects(initiators);
  if (list.length === 0) return rank(level) >= rank("CREATOR");
  return level !== "NONE" && matchesSubject(member, list);
}

/** Creates a review with the next per-project number, retrying if two start at once. */
export async function createReview(input: {
  projectId: string;
  workflowId: string;
  name: string;
  versionIds: string[];
  initiatorId: string;
  firstStepDays: number;
  auto: boolean;
}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const last = await tx.review.findFirst({ where: { projectId: input.projectId }, orderBy: { number: "desc" }, select: { number: true } });
        const number = (last?.number ?? 0) + 1;
        const review = await tx.review.create({
          data: {
            projectId: input.projectId,
            workflowId: input.workflowId,
            number,
            name: input.name,
            initiatorId: input.initiatorId,
            autoStarted: input.auto,
            stepDueAt: dueDate(new Date(), input.firstStepDays),
            documents: { create: input.versionIds.map((versionId) => ({ versionId })) },
          },
        });
        await tx.auditEvent.create({
          data: {
            actorId: input.initiatorId,
            projectId: input.projectId,
            action: input.auto ? "review.auto_started" : "review.started",
            details: { reviewId: review.id, number, name: input.name, files: input.versionIds.length },
          },
        });
        return review;
      });
    } catch (e) {
      if (!isUniqueViolation(e) || attempt === 2) throw e;
    }
  }
  throw new Error("unreachable");
}

/**
 * Re-evaluates the current step of an open review. If it is complete, moves to the
 * next step, or closes the review and records each file's outcome. Returns what happened.
 */
export async function advanceReview(reviewId: string, actorId: string): Promise<"waiting" | "next" | "closed"> {
  const review = await db.review.findUnique({
    where: { id: reviewId },
    include: { workflow: { include: { steps: { orderBy: { order: "asc" } } } }, documents: { select: { id: true } } },
  });
  if (!review || review.status !== "OPEN") return "waiting";
  const steps = review.workflow.steps.map(toStepDef);
  const step = steps.find((s) => s.order === review.currentStep);
  if (!step) return "waiting";
  const [members, grants, rows] = await Promise.all([
    projectMembers(review.projectId),
    db.servicePermission.findMany({ where: { projectId: review.projectId } }),
    db.reviewDecision.findMany({ where: { reviewId, step: step.order } }),
  ]);
  const docIds = review.documents.map((d) => d.id);
  const decisions: Decision[] = rows.map((r) => ({ reviewerId: r.reviewerId, documentId: r.reviewDocumentId, outcome: r.outcome as Outcome }));
  const eligible = eligibleReviewers(members, grants as Parameters<typeof effectiveLevel>[2], step).map((m) => m.userId);
  if (!stepComplete(step.mode, decisions, docIds, eligible)) return "waiting";

  const next = steps.find((s) => s.order === step.order + 1);
  if (next) {
    // only move on if nobody else already did
    const moved = await db.$transaction(async (tx) => {
      const r = await tx.review.updateMany({
        where: { id: reviewId, status: "OPEN", currentStep: step.order },
        data: { currentStep: next.order, stepDueAt: dueDate(new Date(), next.days) },
      });
      if (r.count)
        await tx.auditEvent.create({
          data: { actorId, projectId: review.projectId, action: "review.step_completed", details: { reviewId, number: review.number, step: step.order, next: next.name } },
        });
      return r.count > 0;
    });
    return moved ? "next" : "waiting";
  }

  const results = stepResults(decisions, docIds);
  const closed = await db.$transaction(async (tx) => {
    const r = await tx.review.updateMany({
      where: { id: reviewId, status: "OPEN", currentStep: step.order },
      data: { status: "CLOSED", closedAt: new Date(), stepDueAt: null },
    });
    if (!r.count) return false;
    for (const [docId, outcome] of results) await tx.reviewDocument.update({ where: { id: docId }, data: { outcome } });
    const tally: Record<string, number> = {};
    for (const o of results.values()) tally[o] = (tally[o] ?? 0) + 1;
    await tx.auditEvent.create({
      data: { actorId, projectId: review.projectId, action: "review.closed", details: { reviewId, number: review.number, name: review.name, outcomes: tally } },
    });
    return true;
  });
  if (!closed) return "waiting";
  if (review.workflow.approvedFolderId) {
    try {
      await copyApprovedFiles(reviewId, review.workflow.approvedFolderId, actorId);
    } catch (e) {
      console.error("reviews: copying approved files failed", e);
    }
  }
  return "closed";
}

/** ⭐ Copies each approved file of a closed review into the workflow's chosen folder, stacking by name. */
export async function copyApprovedFiles(reviewId: string, folderId: string, actorId: string) {
  const review = await db.review.findUnique({
    where: { id: reviewId },
    include: { documents: { include: { version: { include: { document: { select: { name: true } } } } } } },
  });
  const folder = await db.folder.findFirst({ where: { id: folderId, projectId: review?.projectId } });
  if (!review || !folder) return 0;
  const storage = getStorage();
  const copied: string[] = [];
  for (const rd of review.documents) {
    if (!isApproved(rd.outcome as Outcome | null) || rd.copiedVersionId) continue;
    const v = rd.version;
    const name = v.document.name;
    const key = storageKey(review.projectId, name, randomBytes(16).toString("hex"));
    await storage.write(key, await storage.read(v.storageKey), v.contentType);
    const save = () =>
      db.$transaction(async (tx) => {
        const existing = await tx.document.findUnique({ where: { folderId_nameKey: { folderId, nameKey: nameKey(name) } } });
        const doc = existing
          ? await tx.document.update({
              where: { id: existing.id },
              data: { currentVersion: { increment: 1 }, size: v.size, contentType: v.contentType, updatedAt: new Date() },
            })
          : await tx.document.create({
              data: { projectId: review.projectId, folderId, name, nameKey: nameKey(name), size: v.size, contentType: v.contentType },
            });
        const nv = await tx.documentVersion.create({
          data: { documentId: doc.id, number: doc.currentVersion, storageKey: key, fileName: v.fileName, size: v.size, contentType: v.contentType, uploadedById: actorId },
        });
        await tx.reviewDocument.update({ where: { id: rd.id }, data: { copiedVersionId: nv.id } });
        await tx.auditEvent.create({
          data: {
            actorId,
            projectId: review.projectId,
            action: "review.file_copied",
            details: { reviewId, number: review.number, name, from: versionLabel(v.number), to: folder.name, version: versionLabel(doc.currentVersion) },
          },
        });
        return nv.id;
      });
    let id: string;
    try {
      id = await save();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      id = await save();
    }
    copied.push(id);
    try {
      await syncSheetsForVersion(review.projectId, id);
    } catch (e) {
      console.error("sheets: failed for copied", name, e);
    }
    try {
      await queueVersion(review.projectId, id);
    } catch (e) {
      console.error("search: couldn't queue copied", name, e);
    }
  }
  if (copied.length) {
    try {
      after(() => runIndexJobs({ limit: 10 }).catch((e) => console.error("search: index run failed", e)));
    } catch {
      // outside a request (scripts): the next scheduled run picks them up
    }
  }
  return copied.length;
}

/** Starts a review for each active workflow set to auto-start on uploads to this folder. */
export async function autoStartReviews(projectId: string, folderId: string, versionId: string, uploaderId: string) {
  const workflows = await db.reviewWorkflow.findMany({
    where: { projectId, active: true, autoStartFolderId: folderId },
    include: { steps: { orderBy: { order: "asc" }, take: 1 } },
  });
  if (!workflows.length) return 0;
  const v = await db.documentVersion.findUnique({ where: { id: versionId }, include: { document: { select: { name: true } } } });
  if (!v) return 0;
  for (const w of workflows) {
    if (!w.steps[0]) continue;
    await createReview({
      projectId,
      workflowId: w.id,
      name: `${v.document.name} ${versionLabel(v.number)}`,
      versionIds: [versionId],
      initiatorId: uploaderId,
      firstStepDays: w.steps[0].days,
      auto: true,
    });
  }
  return workflows.length;
}

type DocsCtx = Awaited<ReturnType<typeof getDocsContext>>;

/**
 * Who sees a review: Document Control Managers (and admins), its initiator, anyone named
 * as a reviewer in any step, and anyone who can view every file in it.
 */
export function canSeeReview(ctx: DocsCtx, initiatorId: string | null, steps: StepDef[], folderIds: string[]) {
  const level = effectiveLevel(ctx.member, "DOCS", ctx.grants);
  if (level === "NONE") return false;
  if (level === "MANAGER" || initiatorId === ctx.user.id) return true;
  if (steps.some((s) => matchesSubject(ctx.member, s.reviewers))) return true;
  return folderIds.every((f) => levelAtLeast(ctx.levelOn(f), "VIEW"));
}

/** Loads a review the current user may see, with what they may do on it. Null if not found or hidden. */
export async function reviewAccess(projectId: string, reviewId: string) {
  if (typeof reviewId !== "string" || !reviewId || reviewId.length > 64) return null;
  const ctx = await getDocsContext(projectId);
  const review = await db.review.findFirst({
    where: { id: reviewId, projectId },
    include: {
      workflow: { include: { steps: { orderBy: { order: "asc" } }, approvedFolder: { select: { id: true, name: true } } } },
      initiator: { select: { name: true } },
      documents: {
        include: {
          version: { include: { document: { select: { id: true, name: true, folderId: true } } } },
        },
        orderBy: { id: "asc" },
      },
      decisions: { include: { reviewer: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!review) return null;
  const steps = review.workflow.steps.map(toStepDef);
  if (!canSeeReview(ctx, review.initiatorId, steps, review.documents.map((d) => d.version.document.folderId))) return null;
  const isManager = effectiveLevel(ctx.member, "DOCS", ctx.grants) === "MANAGER";
  const current = review.status === "OPEN" ? steps.find((s) => s.order === review.currentStep) : undefined;
  const canReviewNow = !!current && matchesSubject(ctx.member, current.reviewers);
  return { ...ctx, review, steps, current, canReviewNow, isManager };
}

/**
 * True if the user is a reviewer of the current step of an open review that contains
 * this version. Such reviewers may publish markups on it even without Upload access.
 */
export async function isActiveReviewerOf(projectId: string, versionId: string, member: MemberContext) {
  const open = await db.review.findMany({
    where: { projectId, status: "OPEN", documents: { some: { versionId } } },
    select: { currentStep: true, workflow: { select: { steps: { select: { order: true, reviewers: true } } } } },
    take: 50,
  });
  return open.some((r) => {
    const step = r.workflow.steps.find((s) => s.order === r.currentStep);
    return !!step && matchesSubject(member, parseSubjects(step.reviewers));
  });
}
