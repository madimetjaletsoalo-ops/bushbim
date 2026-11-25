import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";
import { can, effectiveLevel } from "@/lib/permissions";
import { locationPaths } from "@/modules/issues/server";
import { STARTER_TEMPLATES, checklistAccess, type ChecklistStatus } from "./logic";

/**
 * Creates the starter templates the first time a project opens Checklists (when it has
 * no templates and no checklists yet). Idempotent: names are unique per project.
 */
export async function ensureChecklistDefaults(projectId: string) {
  const [templates, checklists] = await Promise.all([
    db.checklistTemplate.count({ where: { projectId } }),
    db.checklist.count({ where: { projectId } }),
  ]);
  if (templates || checklists) return;
  try {
    await db.$transaction(async (tx) => {
      for (const t of STARTER_TEMPLATES) {
        await tx.checklistTemplate.create({
          data: {
            projectId,
            name: t.name,
            description: t.description,
            sections: {
              create: t.sections.map((s, si) => ({
                title: s.title,
                order: si,
                items: { create: s.items.map(([label, kind, required], ii) => ({ label, kind, required: !!required, order: ii })) },
              })),
            },
          },
        });
      }
    });
  } catch (e) {
    // two first visits at once: the other request created them
    const unique = typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
    if (!unique) throw e;
  }
}

/** Project context, the member's Checklists level and the lists the forms need, once per request. */
export const getChecklistsContext = cache(async (projectId: string) => {
  const ctx = await getProjectContext(projectId);
  const canView = can(ctx.member, "CHECKLISTS", "view", ctx.grants);
  if (canView) await ensureChecklistDefaults(projectId);
  const [locations, members, companies] = await Promise.all([
    db.location.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
    db.projectMember.findMany({ where: { projectId }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { user: { name: "asc" } } }),
    db.company.findMany({ where: { accountId: ctx.user.accountId }, orderBy: { name: "asc" } }),
  ]);
  const names = new Map<string, string>();
  for (const m of members) names.set(`USER:${m.userId}`, m.user.name);
  for (const c of companies) names.set(`COMPANY:${c.id}`, `${c.name} (company)`);
  return {
    ...ctx,
    level: effectiveLevel(ctx.member, "CHECKLISTS", ctx.grants),
    canView,
    canCreate: can(ctx.member, "CHECKLISTS", "create", ctx.grants),
    canManage: can(ctx.member, "CHECKLISTS", "manage", ctx.grants),
    canRaiseIssues: can(ctx.member, "ISSUES", "create", ctx.grants),
    locations,
    locationPaths: locationPaths(locations),
    members,
    companies,
    assigneeName: (type: string | null, id: string | null) => (type && id ? (names.get(`${type}:${id}`) ?? "Removed") : null),
    isAssignee: (key: string) => names.has(key),
  };
});
export type ChecklistsContext = Awaited<ReturnType<typeof getChecklistsContext>>;

export const accessFor = (
  ctx: ChecklistsContext,
  c: { createdById: string | null; assigneeType: "USER" | "ROLE" | "COMPANY" | null; assigneeId: string | null; status: ChecklistStatus },
) => checklistAccess(ctx.level, ctx.member, c);

/** A checklist of this project with everything the detail page and the PDF show. */
export async function loadChecklistFull(projectId: string, checklistId: string) {
  if (!checklistId || checklistId.length > 64) return null;
  return db.checklist.findFirst({
    where: { id: checklistId, projectId },
    include: {
      createdBy: { select: { name: true } },
      completedBy: { select: { name: true } },
      sections: {
        orderBy: { order: "asc" },
        include: {
          items: {
            orderBy: { order: "asc" },
            include: {
              answeredBy: { select: { name: true } },
              issue: { select: { id: true, number: true, status: { select: { name: true, color: true } } } },
              photos: { orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, thumbKey: true, caption: true, uploadedById: true } },
            },
          },
        },
      },
    },
  });
}
export type ChecklistFull = NonNullable<Awaited<ReturnType<typeof loadChecklistFull>>>;

/** Creates a checklist with the next per-project number, retrying if two are created at once. */
export async function createChecklistRow(
  data: Omit<Prisma.ChecklistUncheckedCreateInput, "number" | "sections" | "items">,
  sections: { title: string; items: { label: string; kind: Prisma.ChecklistItemCreateManyInput["kind"]; required: boolean }[] }[],
  actorId: string,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const last = await tx.checklist.findFirst({ where: { projectId: data.projectId }, orderBy: { number: "desc" }, select: { number: true } });
        const number = (last?.number ?? 0) + 1;
        const checklist = await tx.checklist.create({ data: { ...data, number } });
        for (const [si, s] of sections.entries()) {
          const section = await tx.checklistSection.create({ data: { checklistId: checklist.id, title: s.title, order: si } });
          await tx.checklistItem.createMany({
            data: s.items.map((it, ii) => ({ checklistId: checklist.id, sectionId: section.id, label: it.label, kind: it.kind, required: it.required, order: ii })),
          });
        }
        await tx.auditEvent.create({
          data: { actorId, projectId: data.projectId, action: "checklist.created", details: { checklistId: checklist.id, number, title: data.title, template: data.templateName } },
        });
        return checklist;
      });
    } catch (e) {
      const unique = typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
      if (!unique || attempt >= 2) throw e;
    }
  }
}
