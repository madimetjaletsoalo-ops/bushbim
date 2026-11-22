import { describe, expect, it } from "vitest";
import { can, effectiveLevel, type Grant, type MemberContext } from "@/lib/permissions";

const base: MemberContext = {
  userId: "u1",
  accessLevel: "MEMBER",
  companyId: "c1",
  roleIds: ["r1"],
  services: ["DOCS", "ISSUES"],
};

describe("effectiveLevel", () => {
  it("gives project admins MANAGER on every service, even if not enabled", () => {
    expect(effectiveLevel({ ...base, accessLevel: "PROJECT_ADMIN", services: [] }, "DAILY_LOGS", [])).toBe("MANAGER");
  });
  it("gives account admins MANAGER", () => {
    expect(effectiveLevel({ ...base, isAccountAdmin: true }, "CHECKLISTS", [])).toBe("MANAGER");
  });
  it("returns NONE when the service is not enabled for the member", () => {
    const grants: Grant[] = [{ service: "CHECKLISTS", subjectType: "USER", subjectId: "u1", level: "MANAGER" }];
    expect(effectiveLevel(base, "CHECKLISTS", grants)).toBe("NONE");
  });
  it("defaults to VIEWER when enabled but no grant applies", () => {
    expect(effectiveLevel(base, "DOCS", [])).toBe("VIEWER");
  });
  it("takes the highest of user, role and company grants", () => {
    const grants: Grant[] = [
      { service: "ISSUES", subjectType: "USER", subjectId: "u1", level: "VIEWER" },
      { service: "ISSUES", subjectType: "ROLE", subjectId: "r1", level: "CREATOR" },
      { service: "ISSUES", subjectType: "COMPANY", subjectId: "c1", level: "MANAGER" },
      { service: "ISSUES", subjectType: "COMPANY", subjectId: "other", level: "MANAGER" },
    ];
    expect(effectiveLevel(base, "ISSUES", grants)).toBe("MANAGER");
    expect(effectiveLevel({ ...base, companyId: null }, "ISSUES", grants)).toBe("CREATOR");
  });
  it("ignores grants for other services and other subjects", () => {
    const grants: Grant[] = [
      { service: "DOCS", subjectType: "USER", subjectId: "u2", level: "MANAGER" },
      { service: "ISSUES", subjectType: "USER", subjectId: "u1", level: "MANAGER" },
    ];
    expect(effectiveLevel(base, "DOCS", grants)).toBe("VIEWER");
  });
});

describe("can", () => {
  const grants: Grant[] = [{ service: "DOCS", subjectType: "ROLE", subjectId: "r1", level: "CREATOR" }];
  it("maps actions to minimum levels", () => {
    expect(can(base, "DOCS", "view", grants)).toBe(true);
    expect(can(base, "DOCS", "create", grants)).toBe(true);
    expect(can(base, "DOCS", "manage", grants)).toBe(false);
  });
  it("denies non-members", () => {
    expect(can(null, "DOCS", "view", grants)).toBe(false);
  });
});
