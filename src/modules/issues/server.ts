import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";
import { can, effectiveLevel } from "@/lib/permissions";
import { DEFAULT_ROOT_CAUSES, DEFAULT_STATUSES, DEFAULT_TYPES, issueAccess, orderStatuses } from "./logic";

/** Creates the default statuses, types and root causes the first time a project opens Issues. Idempotent. */
export async function ensureIssueDefaults(projectId: string) {
  const has = await db.issueStatus.findFirst({ where: { projectId }, select: { id: true } });
  if (has) return;
  await db.$transaction(async (tx) => {
    await tx.issueStatus.createMany({
      data: DEFAULT_STATUSES.map((s, i) => ({ projectId, name: s.name, color: s.color, closed: !!s.closed, draft: !!s.draft, isDefault: !!s.isDefault, order: i })),
      skipDuplicates: true,
    });
    for (const t of DEFAULT_TYPES) {
      const type = await tx.issueType.upsert({ where: { projectId_name: { projectId, name: t.name } }, update: {}, create: { projectId, name: t.name } });
      await tx.issueSubtype.createMany({ data: t.subtypes.map((name) => ({ typeId: type.id, name })), skipDuplicates: true });
    }
    await tx.issueRootCause.createMany({ data: DEFAULT_ROOT_CAUSES.map((name) => ({ projectId, name })), skipDuplicates: true });
  });
}

/** Project context, the member's Issues level and the project's issue configuration, once per request. */
export const getIssuesContext = cache(async (projectId: string) => {
  const ctx = await getProjectContext(projectId);
  await ensureIssueDefaults(projectId);
  const [statuses, types, rootCauses, attributes, locations, members, roles, companies] = await Promise.all([
    db.issueStatus.findMany({ where: { projectId } }),
    db.issueType.findMany({ where: { projectId }, include: { subtypes: { orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }),
    db.issueRootCause.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
    db.issueAttribute.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    db.location.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
    db.projectMember.findMany({ where: { projectId }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { user: { name: "asc" } } }),
    db.role.findMany({ where: { accountId: ctx.user.accountId }, orderBy: { name: "asc" } }),
    db.company.findMany({ where: { accountId: ctx.user.accountId }, orderBy: { name: "asc" } }),
  ]);
  const level = effectiveLevel(ctx.member, "ISSUES", ctx.grants);
  const names = new Map<string, string>();
  for (const m of members) names.set(`USER:${m.userId}`, m.user.name);
  for (const r of roles) names.set(`ROLE:${r.id}`, `${r.name} (role)`);
  for (const c of companies) names.set(`COMPANY:${c.id}`, `${c.name} (company)`);
  return {
    ...ctx,
    level,
    canView: can(ctx.member, "ISSUES", "view", ctx.grants),
    canCreate: can(ctx.member, "ISSUES", "create", ctx.grants),
    canManage: can(ctx.member, "ISSUES", "manage", ctx.grants),
    statuses: orderStatuses(statuses),
    types,
    rootCauses,
    attributes,
    locations,
    locationPaths: locationPaths(locations),
    members,
    roles,
    companies,
    assigneeName: (type: string | null, id: string | null) => (type && id ? (names.get(`${type}:${id}`) ?? "Removed") : null),
    isAssignee: (key: string) => names.has(key),
  };
});
export type IssuesContext = Awaited<ReturnType<typeof getIssuesContext>>;

/** "Site › Zone A › Villa 3" for every location, sorted by path. */
export function locationPaths(locations: { id: string; parentId: string | null; name: string }[]) {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const path = (id: string) => {
    const parts: string[] = [];
    for (let l = byId.get(id), guard = 0; l && guard < 20; l = l.parentId ? byId.get(l.parentId) : undefined, guard++) parts.unshift(l.name);
    return parts;
  };
  return locations
    .map((l) => ({ id: l.id, path: path(l.id).join(" › "), depth: path(l.id).length - 1 }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export const accessFor = (ctx: IssuesContext, issue: { createdById: string | null; assigneeType: "USER" | "ROLE" | "COMPANY" | null; assigneeId: string | null; status: { draft: boolean } }) =>
  issueAccess(ctx.level, ctx.member, { ...issue, draft: issue.status.draft });

/** Creates an issue with the next per-project number, retrying if two are created at once. */
export async function createIssueRow(data: Omit<Prisma.IssueUncheckedCreateInput, "number">, watcherIds: string[], actorId: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const last = await tx.issue.findFirst({ where: { projectId: data.projectId }, orderBy: { number: "desc" }, select: { number: true } });
        const number = (last?.number ?? 0) + 1;
        const issue = await tx.issue.create({ data: { ...data, number, watchers: { create: watcherIds.map((userId) => ({ userId })) } } });
        await tx.auditEvent.create({
          data: { actorId, projectId: data.projectId, action: "issue.created", details: { issueId: issue.id, number, title: data.title } },
        });
        return issue;
      });
    } catch (e) {
      const unique = typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
      if (!unique || attempt >= 2) throw e;
    }
  }
}
