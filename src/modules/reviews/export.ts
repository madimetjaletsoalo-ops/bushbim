import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// ⭐ Export of a closed review: a summary (files, outcomes, every step's decisions and
// comments) followed by each file's pages with its published markups flattened in.

export interface ReviewSummary {
  title: string;
  lines: [string, string][];
  files: { name: string; outcome: string; note?: string }[];
  steps: { title: string; decisions: { reviewer: string; when: string; items: { file: string; outcome: string; comment: string | null }[] }[] }[];
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;

/** Keeps only characters the built-in Helvetica (WinAnsi) can draw. */
export function printable(font: Pick<PDFFont, "encodeText">, s: string) {
  return [...s]
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return "?";
      }
    })
    .join("");
}

/** Greedy word wrap to a width; long words are split. */
export function wrap(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      let w = word;
      while (measure(w) > width && w.length > 1) {
        let i = w.length - 1;
        while (i > 1 && measure(w.slice(0, i)) > width) i--;
        out.push(w.slice(0, i));
        w = w.slice(i);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
  }
  text(s: string, opts: { size?: number; bold?: boolean; indent?: number; color?: [number, number, number]; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const indent = opts.indent ?? 0;
    const width = A4[0] - MARGIN * 2 - indent;
    for (const line of wrap(printable(font, s), width, (x) => font.widthOfTextAtSize(x, size))) {
      if (this.y - size < MARGIN) this.newPage();
      this.y -= size + 3;
      this.page.drawText(line, { x: MARGIN + indent, y: this.y, size, font, color: rgb(...(opts.color ?? [0.1, 0.1, 0.1])) });
    }
    this.y -= opts.gap ?? 2;
  }
}

/** Builds the export: summary pages, then the given PDFs (already flattened) appended in order. */
export async function buildReviewExport(summary: ReviewSummary, files: Uint8Array[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);
  const soft: [number, number, number] = [0.4, 0.4, 0.4];
  w.text(summary.title, { size: 18, bold: true, gap: 8 });
  for (const [k, v] of summary.lines) w.text(`${k}: ${v}`, { color: soft });
  w.y -= 10;
  w.text("Files", { size: 13, bold: true, gap: 4 });
  for (const f of summary.files) {
    w.text(`${f.name}: ${f.outcome}`, { indent: 8 });
    if (f.note) w.text(f.note, { indent: 16, size: 9, color: soft });
  }
  for (const s of summary.steps) {
    w.y -= 10;
    w.text(s.title, { size: 13, bold: true, gap: 4 });
    if (!s.decisions.length) w.text("No responses.", { indent: 8, color: soft });
    for (const d of s.decisions) {
      w.text(`${d.reviewer} (${d.when})`, { bold: true, indent: 8 });
      for (const it of d.items) {
        w.text(`${it.file}: ${it.outcome}`, { indent: 16 });
        if (it.comment) w.text(it.comment, { indent: 24, size: 9, color: soft });
      }
    }
  }
  for (const bytes of files) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p);
  }
  return doc.save();
}
