import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { isImage, labelAnchor, markupPath, measureLabel, type MarkupType, type Pt } from "./markup";

export interface ExportMarkup {
  page: number;
  type: string;
  points: Pt[];
  color: string;
  text: string | null;
}
export interface ExportScale {
  page: number;
  unitsPerPoint: number;
  unit: string;
}

const hex = (c: string) => {
  const n = parseInt(c.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** Keeps only characters the built-in Helvetica (WinAnsi) can draw. */
function printable(font: PDFFont, s: string) {
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

function drawMarkups(page: PDFPage, font: PDFFont, list: ExportMarkup[], scale: ExportScale | undefined) {
  const { height } = page.getSize();
  // page units have their origin top-left; drawSvgPath at (0, height) uses the same convention
  for (const m of list) {
    const color = hex(m.color);
    if (m.type === "TEXT") {
      const [x, y] = m.points[0];
      for (const [i, line] of printable(font, m.text ?? "").split("\n").entries())
        page.drawText(line, { x, y: height - y - 14 - i * 16, size: 14, font, color });
      continue;
    }
    page.drawSvgPath(markupPath(m.type as MarkupType, m.points), { x: 0, y: height, borderColor: color, borderWidth: 2 });
    if (m.type === "LENGTH" || m.type === "AREA") {
      const [x, y] = labelAnchor(m.type, m.points);
      const label = printable(font, measureLabel(m.type, m.points, scale));
      const w = font.widthOfTextAtSize(label, 11);
      page.drawRectangle({ x: x - w / 2 - 3, y: height - y - 4, width: w + 6, height: 16, color: rgb(1, 1, 1), opacity: 0.85 });
      page.drawText(label, { x: x - w / 2, y: height - y, size: 11, font, color });
    }
  }
}

/** A PDF of the file with the published markups drawn into its pages. */
export async function exportWithMarkups(bytes: Uint8Array, contentType: string, fileName: string, markups: ExportMarkup[], scales: ExportScale[]) {
  let doc: PDFDocument;
  if (isImage(contentType, fileName)) {
    doc = await PDFDocument.create();
    const png = contentType === "image/png" || /\.png$/i.test(fileName);
    const jpg = /^image\/jpe?g$/.test(contentType) || /\.jpe?g$/i.test(fileName);
    if (!png && !jpg) throw new Error("Only PDF, PNG and JPEG files can be exported");
    const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  } else {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPages().forEach((page, i) => {
    const n = i + 1;
    drawMarkups(page, font, markups.filter((m) => m.page === n), scales.find((s) => s.page === n));
  });
  return doc.save();
}
