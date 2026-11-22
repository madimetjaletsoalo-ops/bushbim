import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readPdfText } from "@/modules/docs/sheet-extract";
import {
  DEFAULT_REGIONS,
  cleanTitle,
  isUnderPlans,
  overlayPixels,
  parseSheetNumber,
  regionSchema,
  sheetEditSchema,
  sheetLabels,
  sortSheets,
  textInRegion,
  type TextItem,
} from "@/modules/docs/sheets";

const item = (str: string, x: number, y: number, w = 0.05, h = 0.015): TextItem => ({ str, x, y, w, h });

describe("textInRegion", () => {
  const items = [
    item("GROUND", 0.6, 0.92),
    item("FLOOR PLAN", 0.66, 0.92),
    item("VILLAS 1-6", 0.6, 0.95),
    item("A-101", 0.85, 0.94),
    item("NOTES", 0.1, 0.1),
  ];
  it("reads text inside the box line by line, left to right", () => {
    expect(textInRegion(items, DEFAULT_REGIONS.title)).toBe("GROUND FLOOR PLAN\nVILLAS 1-6");
    expect(textInRegion(items, DEFAULT_REGIONS.number)).toBe("A-101");
  });
  it("ignores text outside the box and blank items", () => {
    expect(textInRegion([item("  ", 0.85, 0.94), item("NOTES", 0.1, 0.1)], DEFAULT_REGIONS.number)).toBe("");
  });
  it("reorders items that arrive out of order", () => {
    expect(textInRegion([item("PLAN", 0.7, 0.92), item("ROOF", 0.6, 0.92)], DEFAULT_REGIONS.title)).toBe("ROOF PLAN");
  });
});

describe("parseSheetNumber", () => {
  it.each([
    ["A-101", "A-101"],
    ["Drawing No.: a101", "A101"],
    ["DWG NO S-201.1", "S-201.1"],
    ["Sheet E 02", "E-02"],
    ["AR-1003B rev C", "AR-1003B"],
    ["Rev C", "Rev"], // nothing number-like: the first word, as written
  ])("%j → %s", (text, expected) => expect(parseSheetNumber(text)).toBe(expected));
  it("returns null for an empty box", () => expect(parseSheetNumber("   ")).toBeNull());
});

describe("sheetLabels", () => {
  it("uses the title block when it has text", () => {
    expect(sheetLabels("A-101", "Title: GROUND  FLOOR\nPLAN", 1, 3, "Set.pdf")).toEqual({ number: "A-101", title: "GROUND FLOOR PLAN" });
  });
  it("falls back to the file name and page", () => {
    expect(sheetLabels("", "", 2, 3, "Tender set.pdf")).toEqual({ number: "Tender set p2", title: "Tender set – page 2" });
    expect(sheetLabels("", "", 1, 1, "Site photo.jpg")).toEqual({ number: "Site photo", title: "Site photo" });
  });
  it("cleans titles", () => expect(cleanTitle("  Drawing title:  Roof\n plan ")).toBe("Roof plan"));
});

describe("validation and helpers", () => {
  it("keeps regions on the page", () => {
    expect(regionSchema.safeParse({ x: 0.8, y: 0.9, w: 0.2, h: 0.1 }).success).toBe(true);
    expect(regionSchema.safeParse({ x: 0.9, y: 0.9, w: 0.2, h: 0.1 }).success).toBe(false);
    expect(regionSchema.safeParse({ x: 0, y: 0, w: 0, h: 0.1 }).success).toBe(false);
  });
  it("requires a number and title when editing", () => {
    expect(sheetEditSchema.safeParse({ number: " ", title: "x" }).success).toBe(false);
    expect(sheetEditSchema.safeParse({ number: "A-1", title: "Plan" }).success).toBe(true);
  });
  it("knows which folders are under Plans", () => {
    const folders = [
      { id: "plans", parentId: null, root: "PLANS" },
      { id: "pf", parentId: null, root: "PROJECT_FILES" },
      { id: "arch", parentId: "plans", root: null },
      { id: "deep", parentId: "arch", root: null },
      { id: "misc", parentId: "pf", root: null },
    ];
    expect(isUnderPlans(folders, "deep")).toBe(true);
    expect(isUnderPlans(folders, "plans")).toBe(true);
    expect(isUnderPlans(folders, "misc")).toBe(false);
    expect(isUnderPlans(folders, "nope")).toBe(false);
  });
  it("sorts sheet numbers naturally", () => {
    const s = sortSheets([{ number: "A-10", title: "" }, { number: "A-2", title: "" }, { number: "S-1", title: "" }]);
    expect(s.map((x) => x.number)).toEqual(["A-2", "A-10", "S-1"]);
  });
});

describe("overlayPixels", () => {
  const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);
  const white = [255, 255, 255, 255];
  const black = [0, 0, 0, 255];
  const run = (a: number[], b: number[]) => {
    const out = new Uint8ClampedArray(4);
    overlayPixels(px(...a), px(...b), out);
    return [...out].map(Math.round);
  };
  it("keeps ink in both versions black and paper white", () => {
    expect(run(black, black)).toEqual([0, 0, 0, 255]);
    expect(run(white, white)).toEqual([255, 255, 255, 255]);
  });
  it("shows removed lines (only in the older version) red and added lines blue", () => {
    expect(run(black, white)).toEqual([255, 0, 0, 255]);
    expect(run(white, black)).toEqual([0, 0, 255, 255]);
  });
  it("treats transparent pixels as paper", () => {
    expect(run([0, 0, 0, 0], [0, 0, 0, 0])).toEqual([255, 255, 255, 255]);
  });
});

describe("readPdfText", () => {
  it("reads each page's title block from a real PDF", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const [no, title] of [["A-101", "GROUND FLOOR PLAN"], ["A-102", "ROOF PLAN"], ["", ""]]) {
      const p = doc.addPage([1191, 842]); // A3 landscape
      p.drawText("GENERAL NOTES", { x: 60, y: 780, size: 12, font });
      if (title) p.drawText(title, { x: 700, y: 40, size: 14, font });
      if (no) {
        p.drawText("Drawing No.", { x: 1000, y: 62, size: 7, font });
        p.drawText(no, { x: 1000, y: 40, size: 18, font });
      }
    }
    const { pageCount, pages } = await readPdfText(await doc.save());
    expect(pageCount).toBe(3);
    const labels = pages.map((items, i) =>
      sheetLabels(textInRegion(items, DEFAULT_REGIONS.number), textInRegion(items, DEFAULT_REGIONS.title), i + 1, pageCount, "Villa set.pdf"),
    );
    expect(labels).toEqual([
      { number: "A-101", title: "GROUND FLOOR PLAN" },
      { number: "A-102", title: "ROOF PLAN" },
      { number: "Villa set p3", title: "Villa set – page 3" },
    ]);
  });
});
