import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { db } from "./db";
import { readSessionUserId } from "./session";
import { isProjectAdmin, type Grant, type MemberContext, type ServiceKey } from "./permissions";

export const getCurrentUser = cache(async () => {
  const id = await readSessionUserId();
  if (!id) return null;
  return db.user.findUnique({ where: { id }, include: { account: true } });
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user || !user.passwordHash) redirect("/login");
  return user;
}

export async function requireAccountAdmin() {
  const user = await requireUser();
  if (user.accountRole !== "ACCOUNT_ADMIN") redirect("/projects");
  return user;
}

/** Loads a project the current user may see, plus their permission context. 404s otherwise. */
export const getProjectContext = cache(async (projectId: string) => {
  const user = await requireUser();
  const project = await db.project.findFirst({ where: { id: projectId, accountId: user.accountId } });
  if (!project) notFound();
  const membership = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
    include: { roles: true },
  });
  const isAccountAdmin = user.accountRole === "ACCOUNT_ADMIN";
  if (!membership && !isAccountAdmin) notFound();
  const member: MemberContext = membership
    ? {
        userId: user.id,
        accessLevel: membership.accessLevel,
        isAccountAdmin,
        companyId: membership.companyId,
        roleIds: membership.roles.map((r) => r.roleId),
        services: membership.services as ServiceKey[],
      }
    : { userId: user.id, accessLevel: "PROJECT_ADMIN", isAccountAdmin, companyId: null, roleIds: [], services: [] };
  const grants = (await db.servicePermission.findMany({ where: { projectId } })) as Grant[];
  return { user, project, member, grants, isAdmin: isProjectAdmin(member) };
});

export async function requireProjectAdmin(projectId: string) {
  const ctx = await getProjectContext(projectId);
  if (!ctx.isAdmin) redirect(`/projects/${projectId}`);
  return ctx;
}
