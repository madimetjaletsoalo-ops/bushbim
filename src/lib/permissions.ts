// Pure permission logic, shared by every module. No database access here so it
// can be unit-tested and reused on client and server.

export const SERVICES = ["DOCS", "ISSUES", "CHECKLISTS", "DAILY_LOGS"] as const;
export type ServiceKey = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<ServiceKey, string> = {
  DOCS: "Document Control",
  ISSUES: "Issues",
  CHECKLISTS: "Checklists",
  DAILY_LOGS: "Daily Logs",
};

export const LEVELS = ["NONE", "VIEWER", "CREATOR", "MANAGER"] as const;
export type Level = (typeof LEVELS)[number];

export type Action = "view" | "create" | "manage";

const ACTION_MIN_LEVEL: Record<Action, Level> = {
  view: "VIEWER",
  create: "CREATOR",
  manage: "MANAGER",
};

export interface MemberContext {
  userId: string;
  accessLevel: "PROJECT_ADMIN" | "MEMBER";
  isAccountAdmin?: boolean;
  companyId: string | null;
  roleIds: string[];
  services: ServiceKey[];
}

export interface Grant {
  service: ServiceKey;
  subjectType: "USER" | "ROLE" | "COMPANY";
  subjectId: string;
  level: Level;
}

export const rank = (l: Level) => LEVELS.indexOf(l);
export const maxLevel = (a: Level, b: Level): Level => (rank(a) >= rank(b) ? a : b);

/**
 * Effective level of a member on a service:
 * - account admins and project admins are MANAGER everywhere;
 * - a member without the service enabled has NONE;
 * - otherwise the highest grant for their user, any of their roles, or their company,
 *   with VIEWER as the floor once the service is enabled.
 */
export function effectiveLevel(member: MemberContext, service: ServiceKey, grants: Grant[]): Level {
  if (member.isAccountAdmin || member.accessLevel === "PROJECT_ADMIN") return "MANAGER";
  if (!member.services.includes(service)) return "NONE";
  let level: Level = "VIEWER";
  for (const g of grants) {
    if (g.service !== service) continue;
    const applies =
      (g.subjectType === "USER" && g.subjectId === member.userId) ||
      (g.subjectType === "ROLE" && member.roleIds.includes(g.subjectId)) ||
      (g.subjectType === "COMPANY" && g.subjectId === member.companyId);
    if (applies) level = maxLevel(level, g.level);
  }
  return level;
}

export function can(member: MemberContext | null, service: ServiceKey, action: Action, grants: Grant[]): boolean {
  if (!member) return false;
  return rank(effectiveLevel(member, service, grants)) >= rank(ACTION_MIN_LEVEL[action]);
}

export function isProjectAdmin(member: MemberContext | null): boolean {
  return !!member && (member.isAccountAdmin === true || member.accessLevel === "PROJECT_ADMIN");
}
