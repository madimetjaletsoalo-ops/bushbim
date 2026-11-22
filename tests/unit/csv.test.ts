import { describe, expect, it } from "vitest";
import { parseInviteCsv } from "@/lib/csv";

describe("parseInviteCsv", () => {
  it("parses rows, skips header and blank lines, handles quotes", () => {
    const { rows, errors } = parseInviteCsv(
      'email,name,company,role,access\nThandi@Example.com,"Thandi, M",Savanna Builders,Site Manager,admin\n\nkofi@example.com,,,,\n',
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ email: "thandi@example.com", name: "Thandi, M", company: "Savanna Builders", role: "Site Manager", accessLevel: "PROJECT_ADMIN" });
    expect(rows[1]).toMatchObject({ email: "kofi@example.com", name: "kofi", accessLevel: "MEMBER" });
  });
  it("reports invalid emails, duplicates and bad access levels with line numbers", () => {
    const { rows, errors } = parseInviteCsv("a@x.com\nnot-an-email\nA@x.com\nb@x.com,B,,,owner");
    expect(rows.map((r) => r.email)).toEqual(["a@x.com"]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });
});
