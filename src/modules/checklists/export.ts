import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { printable, wrap } from "@/modules/reviews/export";

// PDF of a checklist's result: header details, then every section's items with their
// answers, who answered and when, notes, raised issues, signatures and photo thumbnails.

export interface ChecklistReport {
  title: string;
  lines: [string, string][];
  summary: string;
  sections: {
    title: string;
    items: {
      label: string;
      required: boolean;
      answer: string;
      failed: boolean;
      meta?: string;
      note?: string | null;
      issue?: string | null;
      /** PNG bytes of a drawn signature */
      signature?: Uint8Array | null;
      /** JPEG thumbnails of photos */
      photos?: Uint8Array[];
    }[];
  }[];
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 45;
const WIDTH = A4[0] - MARGIN * 2;
const ANSWER_X = MARGIN + WIDTH * 0.68;

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
  image(img: PDFImage, x: number, maxW: number, maxH: number) {
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    this.page.drawImage(img, { x, y: this.y - h, width: w, height: h });
    return { w, h };
  }
}

export async function buildChecklistPdf(r: ChecklistReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(r.title);
  doc.setProducer("BushBIM");
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));

  w.text("BushBIM checklist", { size: 9, color: [0.4, 0.4, 0.4] });
  w.text(r.title, { size: 16, bold: true, gap: 8 });
  for (const [k, v] of r.lines) {
    const before = w.y;
    w.text(k, { size: 9, bold: true, width: 110 });
    const after = w.y;
    w.y = before;
    w.text(v, { size: 9, x: MARGIN + 115 });
    w.y = Math.min(w.y, after);
  }
  w.y -= 4;
  w.text(r.summary, { size: 10, bold: true, gap: 10 });

  for (const s of r.sections) {
    w.ensure(40);
    w.y -= 4;
    w.text(s.title, { size: 12, bold: true, gap: 4 });
    w.rule();
    for (const it of s.items) {
      // keep an item's first line with its answer
      w.ensure(28);
      const top = w.y;
      w.text(`${it.label}${it.required ? " *" : ""}`, { size: 10, width: ANSWER_X - MARGIN - 10 });
      const afterLabel = w.y;
      w.y = top;
      w.text(it.answer || "Not answered", { size: 10, bold: !!it.answer, x: ANSWER_X, color: it.failed ? [0.75, 0.1, 0.1] : it.answer ? [0.1, 0.1, 0.1] : [0.55, 0.55, 0.55] });
      w.y = Math.min(w.y, afterLabel);
      if (it.meta) w.text(it.meta, { size: 8, color: [0.45, 0.45, 0.45] });
      if (it.note) w.text(`Note: ${it.note}`, { size: 9, color: [0.25, 0.25, 0.25] });
      if (it.issue) w.text(`Issue raised: ${it.issue}`, { size: 9, color: [0.75, 0.1, 0.1] });
      if (it.signature) {
        try {
          const img = await doc.embedPng(it.signature);
          w.ensure(64);
          w.y -= 2;
          const { h } = w.image(img, MARGIN, 180, 60);
          w.y -= h + 4;
        } catch {
          w.text("(signature could not be read)", { size: 8, color: [0.5, 0.5, 0.5] });
        }
      }
      if (it.photos?.length) {
        let x = MARGIN;
        let rowH = 0;
        w.ensure(100);
        for (const bytes of it.photos) {
          let img: PDFImage;
          try {
            img = await doc.embedJpg(bytes);
          } catch {
            continue;
          }
          if (x + 120 > A4[0] - MARGIN) {
            w.y -= rowH + 6;
            x = MARGIN;
            rowH = 0;
            w.ensure(100);
          }
          const { w: iw, h } = w.image(img, x, 120, 90);
          x += iw + 6;
          rowH = Math.max(rowH, h);
        }
        w.y -= rowH + 6;
      }
      w.y -= 3;
      w.rule();
    }
  }
  w.y -= 6;
  w.text("* required item", { size: 8, color: [0.45, 0.45, 0.45] });
  return doc.save();
}
