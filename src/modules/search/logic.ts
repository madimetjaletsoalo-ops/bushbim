// Pure helpers for full-text search: query parsing, name patterns, text
// normalisation, DOCX/XLSX XML reading and indexing policy. No database or
// file access here, so all of it is unit-tested.
import { z } from "zod";

// ---------- what gets indexed ----------

/** Extracted text kept per version (and fed to the tsvector). */
export const MAX_TEXT_CHARS = 300_000;
/** Text-layer pages below this many characters on average count as scanned and go to OCR. */
export const SCANNED_CHARS_PER_PAGE = 25;
/** OCR is slow (~0.5–2 s a page): only the first pages of a scanned PDF are read. */
export const MAX_OCR_PAGES = 40;
/** Files larger than this are indexed by name only. */
export const MAX_INDEX_BYTES = 100 * 1024 * 1024;
export const MAX_ATTEMPTS = 3;
/** A job still PROCESSING after this long is assumed dead and may be claimed again. */
export const STALE_JOB_MS = 15 * 60 * 1000;

export type Extractor = "pdf" | "docx" | "xlsx" | "image" | "text";

const ext = (fileName: string) => (fileName.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? "");

/** Which extractor reads a file, from its extension (falling back to the content type); null = name only. */
export function extractorFor(fileName: string, contentType: string): Extractor | null {
  const e = ext(fileName);
  const ct = contentType.toLowerCase();
  if (e === "pdf" || ct === "application/pdf") return "pdf";
  if (e === "docx" || ct === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (e === "xlsx" || ct === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (["jpg", "jpeg", "png"].includes(e) || ct === "image/jpeg" || ct === "image/png") return "image";
  if (["txt", "csv", "md"].includes(e) || ct === "text/plain" || ct === "text/csv") return "text";
  return null;
}

/** True when a PDF's text layer is too thin to be anything but scanned images. */
export function needsOcr(pageTexts: string[]): boolean {
  if (!pageTexts.length) return true;
  const chars = pageTexts.reduce((n, t) => n + t.replace(/\s+/g, "").length, 0);
  return chars / pageTexts.length < SCANNED_CHARS_PER_PAGE;
}

/** Strips control characters, collapses blank runs and caps the length. */
export function normalizeText(raw: string, max = MAX_TEXT_CHARS): string {
  const s = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f�]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** What happens to a job after a failure on its nth attempt. */
export const statusAfterFailure = (attempts: number): "PENDING" | "FAILED" => (attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING");

// ---------- DOCX / XLSX ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text of a WordprocessingML part (document, header, footer): runs joined, one line per paragraph. */
export function docxText(xml: string): string {
  let out = "";
  // only text runs carry document text; field codes, properties and the rest are skipped
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\/>|<\/w:(p|tc)>/g)) {
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else if (m[2] === "tab" || m[3] === "tc") out += "\t";
    else out += "\n";
  }
  return out;
}

/** The shared-string table of a workbook, in order. */
export function xlsxSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    out.push(decodeXml([...si.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => m[1]).join("")));
  }
  return out;
}

/** Cell values of one worksheet, one line per row, shared strings resolved. */
export function xlsxSheetText(xml: string, shared: string[]): string {
  const rows: string[] = [];
  for (const row of xml.match(/<row[\s>][\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = [];
    for (const c of row.matchAll(/<c(\s[^>]*)?>([\s\S]*?)<\/c>/g)) {
      const attrs = c[1] ?? "";
      const body = c[2];
      const type = attrs.match(/\st="([^"]+)"/)?.[1];
      if (type === "inlineStr") {
        cells.push(decodeXml([...body.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => m[1]).join("")));
        continue;
      }
      const v = body.match(/<v>([^<]*)<\/v>/)?.[1];
      if (v === undefined) continue;
      if (type === "s") cells.push(shared[Number(v)] ?? "");
      else cells.push(decodeXml(v));
    }
    if (cells.some((x) => x.trim())) rows.push(cells.join("\t"));
  }
  return rows.join("\n");
}

/** Sheet names from xl/workbook.xml. */
export const xlsxSheetNames = (xml: string) => [...xml.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map((m) => decodeXml(m[1]));

// ---------- queries ----------

/** Words (letters and digits, any script) of a fragment. */
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Turns what a user typed into a Postgres to_tsquery expression:
 * words are ANDed and prefix-matched ("waterproof" finds "waterproofing"),
 * "quoted phrases" and joined codes (KLV-ARC-101) must appear in order,
 * OR between terms means either, and -word excludes.
 * The output only ever contains letters, digits and operators, so it can't be malformed.
 * Returns null when nothing searchable is left.
 */
export function toTsQuery(input: string): string | null {
  const parts = input.slice(0, 300).match(/-?"[^"]*"?|\S+/g) ?? [];
  const clauses: string[] = [];
  let orNext = false;
  for (const raw of parts) {
    if (raw === "OR" || raw === "|") {
      orNext = clauses.length > 0;
      continue;
    }
    const negate = raw.startsWith("-") && raw.length > 1;
    const body = negate ? raw.slice(1) : raw;
    const w = words(body).slice(0, 8);
    if (!w.length) continue;
    const phrase = w.map((x) => `${x}:*`).join(" <-> ");
    const term = negate ? `!(${phrase})` : w.length > 1 ? `(${phrase})` : phrase;
    if (orNext && !negate) clauses[clauses.length - 1] = `(${clauses[clauses.length - 1]} | ${term})`;
    else clauses.push(term);
    orNext = false;
    if (clauses.length >= 12) break;
  }
  // a query of only exclusions matches nothing useful
  if (!clauses.some((c) => !c.startsWith("!"))) return null;
  return clauses.join(" & ");
}

/** "#12", "T-3" or a bare number: the item number someone may be looking for. */
export function numberIn(input: string): number | null {
  const m = input.trim().match(/^(?:#|t-?)?(\d{1,7})$/i);
  return m ? Number(m[1]) : null;
}

/**
 * Converts a naming pattern to an anchored, case-insensitive regex (Postgres ARE and JS compatible):
 *   #  one digit     @  one letter     ?  any one character     *  anything
 * Everything else is literal. A file extension after the pattern is allowed,
 * so "KLV-ARC-###" matches "KLV-ARC-101.pdf".
 */
export function namePatternToRegex(pattern: string): string {
  let re = "";
  for (const ch of pattern.trim()) {
    if (ch === "#") re += "[0-9]";
    else if (ch === "@") re += "[a-z]";
    else if (ch === "?") re += ".";
    else if (ch === "*") re += ".*";
    else if (/[\\^$.|()[\]{}+]/.test(ch)) re += `\\${ch}`;
    else re += ch;
  }
  return `^${re}(\\.[a-z0-9]{1,8})?$`;
}

export const MAX_PATTERN = 200;

/** Checks a user regex: length, compiles, and avoids constructs Postgres reads differently from JS. */
export function checkRegex(src: string): string | null {
  if (!src.trim()) return "Enter a pattern.";
  if (src.length > MAX_PATTERN) return `Keep the pattern under ${MAX_PATTERN} characters.`;
  if (/\(\?<[=!]|\(\?<\w|\\[pPkb]|\\[1-9]/.test(src)) return "Lookbehind, named groups, back-references, \\b and \\p aren't supported.";
  try {
    new RegExp(src, "i");
  } catch {
    return "That isn't a valid regular expression.";
  }
  return null;
}

export const KINDS = ["all", "documents", "issues", "reviews", "transmittals"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABELS: Record<Kind, string> = {
  all: "Everything",
  documents: "Documents",
  issues: "Issues",
  reviews: "Reviews",
  transmittals: "Transmittals",
};

const searchSchema = z.object({
  q: z.string().max(300).catch("").default(""),
  kind: z.enum(KINDS).catch("all").default("all"),
  mode: z.enum(["pattern", "regex"]).catch("pattern").default("pattern"),
  name: z.string().max(MAX_PATTERN).catch("").default(""),
  invert: z.literal("1").optional().catch(undefined),
});

export interface SearchRequest {
  q: string;
  tsQuery: string | null;
  number: number | null;
  kind: Kind;
  mode: "pattern" | "regex";
  /** what the user typed in the name filter */
  name: string;
  /** the regex applied to item names, or null when no filter */
  nameRegex: string | null;
  invert: boolean;
  error: string | null;
}

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/** Parses the search page's query string. Never throws. */
export function parseSearch(sp: Record<string, unknown>): SearchRequest {
  const p = searchSchema.parse({ q: first(sp.q), kind: first(sp.kind), mode: first(sp.mode), name: first(sp.name), invert: first(sp.invert) });
  const q = p.q.trim();
  const name = p.name.trim();
  let nameRegex: string | null = null;
  let error: string | null = null;
  if (name) {
    if (p.mode === "regex") {
      error = checkRegex(name);
      if (!error) nameRegex = name;
    } else nameRegex = namePatternToRegex(name);
  }
  return { q, tsQuery: toTsQuery(q), number: numberIn(q), kind: p.kind, mode: p.mode, name, nameRegex, invert: !!p.invert && !!nameRegex, error };
}

/** True when there is something to search for. */
export const hasCriteria = (r: SearchRequest) => !r.error && (!!r.tsQuery || r.number !== null || !!r.nameRegex);

// ---------- snippets ----------

/** Highlight markers passed to ts_headline; control characters never survive normalizeText. */
export const HIT_START = "\u0001";
export const HIT_END = "\u0002";
export const HEADLINE_OPTIONS = `StartSel=${HIT_START}, StopSel=${HIT_END}, MaxFragments=2, MaxWords=18, MinWords=6, FragmentDelimiter=" … "`;

/** Splits a ts_headline result into plain and highlighted runs, for safe rendering. */
export function splitHighlight(snippet: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let hit = false;
  for (const piece of snippet.split(/([\u0001\u0002])/)) {
    if (piece === HIT_START) hit = true;
    else if (piece === HIT_END) hit = false;
    else if (piece) out.push({ text: piece, hit });
  }
  return out;
}

export const METHOD_LABELS: Record<string, string> = {
  PDF_TEXT: "PDF text",
  OCR: "OCR",
  DOCX: "Word",
  XLSX: "Excel",
  TEXT: "Text",
  NONE: "Name only",
};
