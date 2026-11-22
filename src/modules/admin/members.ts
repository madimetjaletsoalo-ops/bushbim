import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma, Service, AccessLevel } from "@prisma/client";

export interface MemberInput {
  email: string;
  name: string;
  companyId?: string | null;
  roleIds?: string[];
  accessLevel: AccessLevel;
  services: Service[];
}

export const newInviteToken = () => randomBytes(24).toString("base64url");

/** Finds or creates the user in the account, then creates or updates their membership. */
export async function upsertMember(
  tx: Prisma.TransactionClient,
  accountId: string,
  projectId: string,
  input: MemberInput,
): Promise<{ created: boolean; userId: string }> {
  const email = input.email.trim().toLowerCase();
  let user = await tx.user.findUnique({ where: { email } });
  if (user && user.accountId !== accountId) {
    throw new Error(`${email} belongs to another organisation`);
  }
  if (!user) {
    user = await tx.user.create({
      data: { email, name: input.name.trim() || email.split("@")[0], accountId, inviteToken: newInviteToken() },
    });
  }
  const existing = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } });
  const data = {
    companyId: input.companyId || null,
    accessLevel: input.accessLevel,
    services: input.services,
    status: user.passwordHash ? ("ACTIVE" as const) : ("INVITED" as const),
  };
  const member = existing
    ? await tx.projectMember.update({ where: { id: existing.id }, data })
    : await tx.projectMember.create({ data: { ...data, projectId, userId: user.id } });
  if (input.roleIds) {
    await tx.memberRole.deleteMany({ where: { memberId: member.id } });
    if (input.roleIds.length)
      await tx.memberRole.createMany({ data: input.roleIds.map((roleId) => ({ memberId: member.id, roleId })) });
  }
  return { created: !existing, userId: user.id };
}
