// Reads the text of each PDF page with pdf.js (Node build), in page fractions,
// so the title block can be matched against configured regions.
import type { TextItem } from "./sheets";

export const MAX_TEXT_PAGES = 300;

async function pdfjs() {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Run the parser on this thread; importing the worker module explicitly also
  // makes sure the deployment bundles it.
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return lib;
}

/** Page count and, for up to MAX_TEXT_PAGES pages, positioned text items. */
export async function readPdfText(bytes: Uint8Array): Promise<{ pageCount: number; pages: TextItem[][] }> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    const pages: TextItem[][] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_TEXT_PAGES); n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const [, , , d, e, f] = it.transform as number[];
        const [x, baseline] = vp.convertToViewportPoint(e, f);
        const h = Math.abs(it.height || d || 10);
        items.push({ str: it.str, x: x / vp.width, y: (baseline - h) / vp.height, w: (it.width || 0) / vp.width, h: h / vp.height });
      }
      pages.push(items);
      page.cleanup();
    }
    return { pageCount: doc.numPages, pages };
  } finally {
    await doc.destroy();
  }
}
