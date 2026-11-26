// Reads the text of Word (.docx) and Excel (.xlsx) files: unzips only the parts
// that hold text, with size limits so a crafted zip can't exhaust memory. Pure.
import { unzipSync } from "fflate";
import { docxText, xlsxSharedStrings, xlsxSheetNames, xlsxSheetText } from "./logic";

/** Zip parts larger than this (uncompressed) are skipped, and the whole read stops past MAX_ZIP_TOTAL. */
const MAX_ZIP_PART = 50 * 1024 * 1024;
const MAX_ZIP_TOTAL = 120 * 1024 * 1024;

const utf8 = new TextDecoder("utf-8", { fatal: false });

export function unzipParts(bytes: Uint8Array, wanted: (name: string) => boolean) {
  let total = 0;
  return unzipSync(bytes, {
    filter: (f) => {
      if (!wanted(f.name) || f.originalSize > MAX_ZIP_PART || total + f.originalSize > MAX_ZIP_TOTAL) return false;
      total += f.originalSize;
      return true;
    },
  });
}

const partNumber = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);

export function readDocx(bytes: Uint8Array): string {
  const parts = unzipParts(bytes, (n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
  const order = (n: string) => (n === "word/document.xml" ? 0 : 1);
  return Object.keys(parts)
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((n) => docxText(utf8.decode(parts[n])))
    .join("\n");
}

export function readXlsx(bytes: Uint8Array): string {
  const parts = unzipParts(bytes, (n) => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = parts["xl/sharedStrings.xml"] ? xlsxSharedStrings(utf8.decode(parts["xl/sharedStrings.xml"])) : [];
  const names = parts["xl/workbook.xml"] ? xlsxSheetNames(utf8.decode(parts["xl/workbook.xml"])) : [];
  return Object.keys(parts)
    .filter((n) => n.startsWith("xl/worksheets/"))
    .sort((a, b) => partNumber(a) - partNumber(b))
    .map((n, i) => [names[i] ?? "", xlsxSheetText(utf8.decode(parts[n]), shared)].filter(Boolean).join("\n"))
    .join("\n\n");
}

