import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { printable, wrap } from "@/modules/reviews/export";

// PDF of a daily log: header details, weather, labour and work per company, equipment,
// visitors, the log's checklist items, notes and photo thumbnails.

export interface DailyLogReport {
  title: string;
  lines: [string, string][];
  sections: { title: string; table?: { head: string[]; widths: number[]; rows: string[][]; foot?: string[] }; text?: string[] }[];
  /** JPEG thumbnails with captions */
  photos: { bytes: Uint8Array; caption: string }[];
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 45;
const WIDTH = A4[0] - MARGIN * 2;
const GREY: [number, number, number] = [0.45, 0.45, 0.45];

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
  }
  ensure(h: number) {
    if (this.y - h < MARGIN) this.newPage();
  }
  lines(s: string, width: number, size: number, bold = false) {
    const font = bold ? this.bold : this.font;
    return wrap(printable(font, s), width, (x) => font.widthOfTextAtSize(x, size));
  }
  text(s: string, opts: { size?: number; bold?: boolean; x?: number; width?: number; color?: [number, number, number]; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = opts.x ?? MARGIN;
    for (const line of this.lines(s, opts.width ?? A4[0] - MARGIN - x, size, opts.bold)) {
      this.ensure(size + 3);
      this.y -= size + 3;
      this.page.drawText(line, { x, y: this.y, size, font, color: rgb(...(opts.color ?? [0.1, 0.1, 0.1])) });
    }
    this.y -= opts.gap ?? 2;
  }
  rule() {
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4[0] - MARGIN, y: this.y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    this.y -= 4;
  }
  /** One table row; cells wrap within their column. */
  row(cells: string[], widths: number[], bold = false) {
    const size = 9;
    const wrapped = cells.map((c, i) => this.lines(c || "-", widths[i]! * WIDTH - 6, size, bold));
    const h = Math.max(...wrapped.map((l) => l.length)) * (size + 3);
    this.ensure(h + 4);
    let x = MARGIN;
    const top = this.y;
    wrapped.forEach((lines, i) => {
      let y = top;
      for (const line of lines) {
        y -= size + 3;
        this.page.drawText(line, { x, y, size, font: bold ? this.bold : this.font, color: rgb(0.1, 0.1, 0.1) });
      }
      x += widths[i]! * WIDTH;
    });
    this.y = top - h - 3;
    this.rule();
  }
  image(img: PDFImage, x: number, maxW: number, maxH: number) {
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    this.page.drawImage(img, { x, y: this.y - h, width: w, height: h });
    return { w, h };
  }
}

export async function buildDailyLogPdf(r: DailyLogReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(r.title);
  doc.setProducer("BushBIM");
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));

  w.text("BushBIM daily log", { size: 9, color: [0.4, 0.4, 0.4] });
  w.text(r.title, { size: 16, bold: true, gap: 8 });
  for (const [k, v] of r.lines) {
    const before = w.y;
    w.text(k, { size: 9, bold: true, width: 110 });
    const after = w.y;
    w.y = before;
    w.text(v, { size: 9, x: MARGIN + 115 });
    w.y = Math.min(w.y, after);
  }

  for (const s of r.sections) {
    w.ensure(50);
    w.y -= 10;
    w.text(s.title, { size: 12, bold: true, gap: 4 });
    w.rule();
    if (s.table) {
      if (!s.table.rows.length) w.text("None recorded.", { size: 9, color: GREY, gap: 4 });
      else {
        w.row(s.table.head, s.table.widths, true);
        for (const row of s.table.rows) w.row(row, s.table.widths);
        if (s.table.foot) w.row(s.table.foot, s.table.widths, true);
      }
    }
    for (const t of s.text ?? []) w.text(t, { size: 10, gap: 4 });
  }

  if (r.photos.length) {
    w.ensure(130);
    w.y -= 10;
    w.text("Photos", { size: 12, bold: true, gap: 4 });
    w.rule();
    let x = MARGIN;
    let rowH = 0;
    for (const p of r.photos) {
      let img: PDFImage;
      try {
        img = await doc.embedJpg(p.bytes);
      } catch {
        continue;
      }
      if (x + 160 > A4[0] - MARGIN) {
        w.y -= rowH + 18;
        x = MARGIN;
        rowH = 0;
      }
      if (w.y - 140 < MARGIN) {
        w.newPage();
        x = MARGIN;
        rowH = 0;
      }
      const { h } = w.image(img, x, 160, 120);
      const cap = w.lines(p.caption, 160, 7)[0] ?? "";
      w.page.drawText(cap, { x, y: w.y - h - 9, size: 7, font: w.font, color: rgb(...GREY) });
      x += 166;
      rowH = Math.max(rowH, h);
    }
    w.y -= rowH + 18;
  }
  return doc.save();
}
