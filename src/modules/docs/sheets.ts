// Pure sheet logic: reading the sheet number and title out of a title-block
// region, and the pixel maths for comparing two versions. Unit tested.
import { z } from "zod";

/** A rectangle as fractions of the page (0..1), origin top-left. */
export const regionSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) })
  .refine((r) => r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, "The box must stay on the page");
export type Region = z.infer<typeof regionSchema>;

/** A typical bottom-right title block: number in the corner, title to its left. */
export const DEFAULT_REGIONS: { number: Region; title: Region } = {
  number: { x: 0.82, y: 0.9, w: 0.17, h: 0.09 },
  title: { x: 0.55, y: 0.9, w: 0.27, h: 0.09 },
};

/** A piece of text on a page, in page fractions; (x, y) is the top-left of its box. */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const inside = (r: Region, px: number, py: number) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

/** Text whose centre falls inside the region, read line by line, left to right. */
export function textInRegion(items: TextItem[], r: Region): string {
  const hits = items.filter((i) => i.str.trim() && inside(r, i.x + i.w / 2, i.y + i.h / 2));
  const lineTol = 0.006;
  hits.sort((a, b) => (Math.abs(a.y - b.y) > lineTol ? a.y - b.y : a.x - b.x));
  const lines: string[][] = [];
  let lastY = -1;
  for (const h of hits) {
    if (lastY < 0 || Math.abs(h.y - lastY) > lineTol) lines.push([]);
    lines[lines.length - 1].push(h.str.trim());
    lastY = h.y;
  }
  return lines.map((l) => l.join(" ")).join("\n").trim();
}

// A-101, A101, S-201.1, E-02, AR-1003B, M 301
const SHEET_NO = /\b([A-Z]{1,4}[-_. ]?\d{1,4}(?:[.-]\d{1,3})?[A-Z]?)\b/;

/** Picks the sheet number out of the number box, ignoring labels such as "Drawing No.". */
export function parseSheetNumber(text: string): string | null {
  const clean = text.replace(/\b(drawing|dwg|sheet)\s*(no\.?|number|#)?\s*:?/gi, " ");
  const m = SHEET_NO.exec(clean.toUpperCase());
  if (m) return m[1].replace(/[_ ]/, "-");
  const word = clean.trim().split(/\s+/)[0];
  return word ? word.slice(0, 40) : null;
}

export function cleanTitle(text: string): string {
  return text
    .replace(/\b(drawing\s+)?title\s*:?/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export const fileStem = (name: string) => name.replace(/\.[^.]+$/, "").trim() || name;

/** Number and title for one page, falling back to the file name when the title block is empty. */
export function sheetLabels(numberText: string, titleText: string, page: number, pageCount: number, fileName: string) {
  const stem = fileStem(fileName);
  const number = parseSheetNumber(numberText) ?? (pageCount > 1 ? `${stem} p${page}` : stem);
  const title = cleanTitle(titleText) || (pageCount > 1 ? `${stem} – page ${page}` : stem);
  return { number: number.slice(0, 60), title };
}

export const sheetEditSchema = z.object({
  number: z.string().trim().min(1, "Sheet number is required").max(60),
  title: z.string().trim().min(1, "Title is required").max(200),
});

/** True when the folder is Plans or anywhere below it. */
export function isUnderPlans(folders: { id: string; parentId: string | null; root: string | null }[], folderId: string): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  let cur = byId.get(folderId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (!cur.parentId) return cur.root === "PLANS";
    cur = byId.get(cur.parentId);
  }
  return false;
}

/** Sorts sheet numbers naturally: A-2 before A-10, then by title. */
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export const sortSheets = <T extends { number: string; title: string }>(sheets: T[]) =>
  [...sheets].sort((a, b) => collator.compare(a.number, b.number) || collator.compare(a.title, b.title));

/**
 * Overlay comparison of two renders (RGBA, same size). Lines in both stay dark,
 * lines only in the older version (A) turn red, lines only in the newer (B) turn blue.
 */
export function overlayPixels(a: Uint8ClampedArray, b: Uint8ClampedArray, out: Uint8ClampedArray) {
  const lum = (d: Uint8ClampedArray, i: number) => {
    const alpha = d[i + 3] / 255;
    // transparent counts as white paper
    return (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * alpha + 255 * (1 - alpha);
  };
  for (let i = 0; i < out.length; i += 4) {
    const la = lum(a, i);
    const lb = lum(b, i);
    out[i] = lb; //     red   = only A has ink here → B is white → stays 255
    out[i + 1] = Math.min(la, lb) * 0.35 + la * 0.65 * (lb / 255); // green: dark wherever either has ink
    out[i + 2] = la; // blue  = only B has ink → A white → stays 255
    out[i + 3] = 255;
  }
}
