import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { readDocx, readXlsx, unzipParts } from "@/modules/search/office";
import {
  MAX_ATTEMPTS,
  checkRegex,
  decodeXml,
  docxText,
  extractorFor,
  hasCriteria,
  namePatternToRegex,
  needsOcr,
  normalizeText,
  numberIn,
  parseSearch,
  splitHighlight,
  statusAfterFailure,
  toTsQuery,
  xlsxSharedStrings,
  xlsxSheetNames,
  xlsxSheetText,
} from "@/modules/search/logic";
import { crc32, inflate, pngFromSamples, rowBytes } from "@/modules/search/png";

describe("toTsQuery", () => {
  it("ANDs prefix-matched words", () => {
    expect(toTsQuery("Thatch  ridge")).toBe("thatch:* & ridge:*");
  });
  it("keeps quoted phrases and joined codes in order", () => {
    expect(toTsQuery('"ridge capping" KLV-ARC-101')).toBe("(ridge:* <-> capping:*) & (klv:* <-> arc:* <-> 101:*)");
  });
  it("supports OR and exclusions", () => {
    expect(toTsQuery("pool OR spa -heater")).toBe("(pool:* | spa:*) & !(heater:*)");
  });
  it("strips everything that could break to_tsquery", () => {
    expect(toTsQuery("a:* & !(b) 'c' \\ <-> d")).toBe("a:* & b:* & c:* & d:*");
  });
  it("handles other scripts and accents", () => {
    expect(toTsQuery("Étanchéité ndlela")).toBe("étanchéité:* & ndlela:*");
  });
  it("returns null when nothing searchable is left", () => {
    expect(toTsQuery("   ")).toBeNull();
    expect(toTsQuery("-only -exclusions")).toBeNull();
    expect(toTsQuery("&&& ***")).toBeNull();
  });
  it("caps the number of clauses", () => {
    expect(toTsQuery(Array.from({ length: 40 }, (_, i) => `w${i}`).join(" "))!.split(" & ")).toHaveLength(12);
  });
});

describe("numberIn", () => {
  it("reads #12, T-3 and bare numbers", () => {
    expect(numberIn("#12")).toBe(12);
    expect(numberIn("T-3")).toBe(3);
    expect(numberIn(" 7 ")).toBe(7);
    expect(numberIn("villa 7")).toBeNull();
  });
});

describe("namePatternToRegex", () => {
  const test = (pattern: string, name: string) => new RegExp(namePatternToRegex(pattern), "i").test(name);
  it("maps # @ ? * and allows an extension", () => {
    expect(test("KLV-ARC-###", "KLV-ARC-101.pdf")).toBe(true);
    expect(test("KLV-ARC-###", "klv-arc-101")).toBe(true);
    expect(test("KLV-ARC-###", "KLV-ARC-10A.pdf")).toBe(false);
    expect(test("KLV-@@@-*", "KLV-STR-Roof framing.dwg")).toBe(true);
    expect(test("Villa ?", "Villa 7.pdf")).toBe(true);
    expect(test("Villa ?", "Villa 12.pdf")).toBe(false);
  });
  it("treats regex characters literally", () => {
    expect(test("Plan (rev.B)", "Plan (rev.B).pdf")).toBe(true);
    expect(test("Plan (rev.B)", "Plan (revXB).pdf")).toBe(false);
    expect(namePatternToRegex("a+b|c")).toBe("^a\\+b\\|c(\\.[a-z0-9]{1,8})?$");
  });
});

describe("checkRegex", () => {
  it("accepts ordinary patterns", () => {
    expect(checkRegex("^KLV-(ARC|STR)-\\d{3}")).toBeNull();
  });
  it("rejects invalid, empty, long and JS-only patterns", () => {
    expect(checkRegex("(unclosed")).toMatch(/valid/);
    expect(checkRegex("  ")).toMatch(/Enter/);
    expect(checkRegex("a".repeat(201))).toMatch(/under 200/);
    expect(checkRegex("(?<=x)y")).toMatch(/Lookbehind/);
    expect(checkRegex("(a)\\1")).toMatch(/back-references/);
    expect(checkRegex("\\bword")).toMatch(/\\b/);
  });
});

describe("parseSearch", () => {
  it("parses a full request", () => {
    const r = parseSearch({ q: " roof leak ", kind: "issues", mode: "pattern", name: "Villa #", invert: "1" });
    expect(r).toMatchObject({ q: "roof leak", tsQuery: "roof:* & leak:*", kind: "issues", nameRegex: "^Villa [0-9](\\.[a-z0-9]{1,8})?$", invert: true, error: null });
    expect(hasCriteria(r)).toBe(true);
  });
  it("falls back on bad values and never throws", () => {
    const r = parseSearch({ q: ["a", "b"], kind: "everything", mode: "weird", name: 5, invert: "yes" });
    expect(r).toMatchObject({ q: "a", kind: "all", mode: "pattern", name: "", nameRegex: null, invert: false });
  });
  it("reports a bad regex and has no criteria", () => {
    const r = parseSearch({ q: "pool", mode: "regex", name: "([" });
    expect(r.error).toMatch(/valid/);
    expect(hasCriteria(r)).toBe(false);
  });
  it("a name filter alone is enough", () => {
    expect(hasCriteria(parseSearch({ mode: "regex", name: "^KLV" }))).toBe(true);
    expect(hasCriteria(parseSearch({}))).toBe(false);
  });
  it("ignores invert without a name filter", () => {
    expect(parseSearch({ q: "x", invert: "1" }).invert).toBe(false);
  });
});

describe("extractorFor", () => {
  it("picks by extension, then content type", () => {
    expect(extractorFor("Plan.PDF", "application/octet-stream")).toBe("pdf");
    expect(extractorFor("Spec.docx", "")).toBe("docx");
    expect(extractorFor("BoQ.xlsx", "")).toBe("xlsx");
    expect(extractorFor("site.jpeg", "")).toBe("image");
    expect(extractorFor("notes.txt", "")).toBe("text");
    expect(extractorFor("upload", "application/pdf")).toBe("pdf");
    expect(extractorFor("model.dwg", "application/acad")).toBeNull();
    expect(extractorFor("old.doc", "application/msword")).toBeNull();
  });
});

describe("needsOcr", () => {
  it("flags PDFs whose text layer is thin", () => {
    expect(needsOcr([])).toBe(true);
    expect(needsOcr(["", " ", "A1"])).toBe(true);
    expect(needsOcr(["General notes: all thatch to be Cape reed, fire retardant treated."])).toBe(false);
  });
});

describe("normalizeText", () => {
  it("removes control characters, collapses blanks and caps", () => {
    expect(normalizeText("a\u0001b\t\t c\r\n\r\n\n  d ")).toBe("a b c\nd");
    expect(normalizeText("x".repeat(50), 10)).toHaveLength(10);
  });
});

describe("statusAfterFailure", () => {
  it("retries until the last attempt", () => {
    expect(statusAfterFailure(1)).toBe("PENDING");
    expect(statusAfterFailure(MAX_ATTEMPTS)).toBe("FAILED");
  });
});

describe("DOCX and XLSX XML", () => {
  it("decodes entities", () => {
    expect(decodeXml("R&amp;D &lt;ok&gt; &#8211; &#x2013; &quot;x&quot; &bogus;")).toBe('R&D <ok> – – "x" &bogus;');
  });
  it("reads runs and paragraphs from WordprocessingML", () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Thatch</w:t></w:r><w:r><w:t xml:space="preserve"> ridge</w:t></w:r></w:p>' +
      "<w:p><w:r><w:t>Cape reed</w:t><w:tab/><w:t>&amp; netting</w:t></w:r></w:p><w:p><w:r><w:instrText>PAGE</w:instrText></w:r></w:p></w:body></w:document>";
    expect(docxText(xml).trim()).toBe("Thatch ridge\nCape reed\t& netting");
  });
  it("resolves shared strings, inline strings and numbers by row", () => {
    const shared = xlsxSharedStrings('<sst><si><t>Item</t></si><si><r><t>Pool </t></r><r><t>pump</t></r></si></sst>');
    expect(shared).toEqual(["Item", "Pool pump"]);
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Qty</t></is></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>2</v></c><c r="C2"><f>B2*2</f></c></row><row r="3"></row></sheetData></worksheet>';
    expect(xlsxSheetText(sheet, shared)).toBe("Item\tQty\nPool pump\t2");
    expect(xlsxSheetNames('<workbook><sheets><sheet name="BoQ &amp; rates" sheetId="1"/><sheet name="Notes" sheetId="2"/></sheets></workbook>')).toEqual(["BoQ & rates", "Notes"]);
  });
  it("reads a .docx and an .xlsx from their zip parts, skipping the rest", () => {
    const docx = zipSync({
      "word/document.xml": strToU8("<w:p><w:r><w:t>Villa 7 thatch spec</w:t></w:r></w:p>"),
      "word/footer1.xml": strToU8("<w:p><w:r><w:t>Kruger Lodge</w:t></w:r></w:p>"),
      "word/media/image1.png": new Uint8Array(1000),
    });
    expect(normalizeText(readDocx(docx))).toBe("Villa 7 thatch spec\nKruger Lodge");
    const xlsx = zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="BoQ" sheetId="1"/></sheets></workbook>'),
      "xl/sharedStrings.xml": strToU8("<sst><si><t>Cape reed bundles</t></si></sst>"),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c t="s"><v>0</v></c><c><v>1200</v></c></row></sheetData></worksheet>'),
    });
    expect(readXlsx(xlsx)).toBe("BoQ\nCape reed bundles\t1200");
    expect(Object.keys(unzipParts(docx, () => true))).toHaveLength(3);
  });
});

describe("splitHighlight", () => {
  it("splits ts_headline output into plain and highlighted runs", () => {
    expect(splitHighlight("the \u0001thatch\u0002 ridge \u0001cap\u0002")).toEqual([
      { text: "the ", hit: false },
      { text: "thatch", hit: true },
      { text: " ridge ", hit: false },
      { text: "cap", hit: true },
    ]);
    expect(splitHighlight("")).toEqual([]);
  });
});

describe("png", () => {
  it("computes the standard CRC-32", () => {
    expect((crc32(new TextEncoder().encode("IEND")) ^ 0xffffffff) >>> 0).toBe(0xae426082);
  });
  it("wraps samples into a PNG with a filter byte per row", () => {
    const img = { width: 3, height: 2, bitDepth: 8 as const, channels: 1 as const };
    const png = pngFromSamples(img, new Uint8Array([0, 128, 255, 10, 20, 30]), true);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new TextDecoder().decode(png.subarray(12, 16))).toBe("IHDR");
    // find IDAT and inflate it: rows are [0, ...inverted samples]
    const at = png.findIndex((_, i) => png[i] === 73 && png[i + 1] === 68 && png[i + 2] === 65 && png[i + 3] === 84);
    const len = new DataView(png.buffer, png.byteOffset + at - 4, 4).getUint32(0);
    expect([...inflate(png.subarray(at + 4, at + 4 + len), 8)]).toEqual([0, 255, 127, 0, 0, 245, 235, 225]);
  });
  it("packs 1-bit rows to whole bytes and rejects short data", () => {
    expect(rowBytes({ width: 10, height: 1, bitDepth: 1, channels: 1 })).toBe(2);
    expect(() => pngFromSamples({ width: 10, height: 2, bitDepth: 1, channels: 1 }, new Uint8Array(3))).toThrow();
  });
});
