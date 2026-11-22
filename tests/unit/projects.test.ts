import { describe, expect, it } from "vitest";
import { projectInitials } from "@/lib/projects";

describe("projectInitials", () => {
  it("prefers the project code", () => expect(projectInitials("Kruger Lodge Villas", "klv")).toBe("KLV"));
  it("keeps codes short", () => expect(projectInitials("X", "OTC-01-PHASE2")).toBe("OTC-01"));
  it("falls back to the first two words", () => expect(projectInitials("Okavango Tented Camp", null)).toBe("OT"));
  it("ignores blank codes and punctuation", () => expect(projectInitials("  — Chobe   river ", "  ")).toBe("CR"));
  it("handles accented and single-word names", () => {
    expect(projectInitials("Île aux Cerfs")).toBe("ÎA");
    expect(projectInitials("Ngorongoro")).toBe("N");
  });
  it("never returns an empty label", () => expect(projectInitials("—")).toBe("?"));
});
