import { describe, expect, it } from "vitest";
import {
  expiryFrom,
  linkState,
  linkToken,
  matchesSearch,
  mergeRecipients,
  parseEmails,
  searchTerms,
  sendSchema,
  transmittalLabel,
  verifyLinkToken,
} from "@/modules/transmittals/logic";

const secret = new TextEncoder().encode("a-test-secret-that-is-long-enough-123456");
const other = new TextEncoder().encode("another-secret-that-is-long-enough-654321");

describe("parseEmails", () => {
  it("splits on commas, semicolons, spaces and new lines, lower-cases and de-duplicates", () => {
    expect(parseEmails("QS@Example.com, eng@firm.co.za;\nqs@example.com  arch@studio.africa").emails).toEqual([
      "qs@example.com",
      "eng@firm.co.za",
      "arch@studio.africa",
    ]);
  });
  it("accepts Name <address> entries", () => {
    expect(parseEmails("Sipho Dlamini <sipho@build.co.za>, Ama <ama@x.gh>")).toEqual({ emails: ["sipho@build.co.za", "ama@x.gh"], invalid: [] });
  });
  it("reports invalid entries", () => {
    const r = parseEmails("good@ok.com, not-an-email, @nope");
    expect(r.emails).toEqual(["good@ok.com"]);
    expect(r.invalid).toEqual(["not-an-email", "@nope"]);
  });
  it("is empty for blank input", () => {
    expect(parseEmails("  \n ")).toEqual({ emails: [], invalid: [] });
  });
});

describe("mergeRecipients", () => {
  const byEmail = new Map([["thandi@lodge.test", { userId: "u2", name: "Thandi" }]]);
  it("keeps members once and links an external email to an existing member", () => {
    const r = mergeRecipients([{ userId: "u1", email: "Lerato@Lodge.test", name: "Lerato" }], ["lerato@lodge.test", "thandi@lodge.test", "qs@out.com"], byEmail);
    expect(r).toEqual([
      { email: "lerato@lodge.test", userId: "u1", name: "Lerato" },
      { email: "thandi@lodge.test", userId: "u2", name: "Thandi" },
      { email: "qs@out.com", userId: null, name: null },
    ]);
  });
});

describe("link tokens", () => {
  it("round-trips and rejects tampering or another secret", () => {
    const t = linkToken("ckrecipient123", secret);
    expect(verifyLinkToken(t, secret)).toBe("ckrecipient123");
    expect(verifyLinkToken(t, other)).toBeNull();
    expect(verifyLinkToken(t.replace("ckrecipient123", "ckrecipient124"), secret)).toBeNull();
    expect(verifyLinkToken(`${t}x`, secret)).toBeNull();
    expect(verifyLinkToken("nodot", secret)).toBeNull();
    expect(verifyLinkToken(".abc", secret)).toBeNull();
    expect(verifyLinkToken("../etc.abc", secret)).toBeNull();
  });
  it("gives each recipient a different link", () => {
    expect(linkToken("a", secret)).not.toBe(linkToken("b", secret));
  });
});

describe("expiry", () => {
  const sent = new Date("2026-11-23T08:00:00Z");
  const t = { expiresAt: expiryFrom(sent, 14), revokedAt: null };
  it("adds whole days", () => {
    expect(t.expiresAt.toISOString()).toBe("2026-12-07T08:00:00.000Z");
  });
  it("is active until the expiry instant, then expired; revoked wins", () => {
    expect(linkState(t, new Date("2026-12-07T07:59:59Z"))).toBe("active");
    expect(linkState(t, new Date("2026-12-07T08:00:00Z"))).toBe("expired");
    expect(linkState({ ...t, revokedAt: sent }, sent)).toBe("revoked");
  });
});

describe("sendSchema", () => {
  const ok = { subject: "IFC set", message: "", expiryDays: "14", versionIds: ["v1"], memberIds: [], external: "" };
  it("accepts valid input and coerces days", () => {
    expect(sendSchema.parse(ok).expiryDays).toBe(14);
  });
  it("rejects out-of-range expiry, no files and blank subjects", () => {
    expect(sendSchema.safeParse({ ...ok, expiryDays: "0" }).success).toBe(false);
    expect(sendSchema.safeParse({ ...ok, expiryDays: "31" }).success).toBe(false);
    expect(sendSchema.safeParse({ ...ok, versionIds: [] }).error?.issues[0]?.message).toBe("Choose at least one file");
    expect(sendSchema.safeParse({ ...ok, subject: "   " }).success).toBe(false);
  });
});

describe("search", () => {
  const texts = ["Spa pavilion IFC", "qs@out.com", "Roof plan.pdf"];
  it("matches every term across texts", () => {
    expect(matchesSearch(searchTerms("spa ROOF"), 3, texts)).toBe(true);
    expect(matchesSearch(searchTerms("spa zebra"), 3, texts)).toBe(false);
    expect(matchesSearch(searchTerms(""), 3, texts)).toBe(true);
  });
  it("matches the transmittal number as T-n, #n or n", () => {
    expect(matchesSearch(["t-3"], 3, texts)).toBe(true);
    expect(matchesSearch(["#3"], 3, texts)).toBe(true);
    expect(matchesSearch(["t-4"], 3, texts)).toBe(false);
    expect(transmittalLabel(3)).toBe("T-3");
  });
});
