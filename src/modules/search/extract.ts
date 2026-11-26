import "server-only";
import type { PDFDict as PDFDictT, PDFNumber as PDFNumberT, PDFRawStream as PDFRawStreamT } from "pdf-lib";
import { readPdfText } from "@/modules/docs/sheet-extract";
import { MAX_OCR_PAGES, extractorFor, needsOcr, normalizeText } from "./logic";
import { readDocx, readXlsx } from "./office";
import { inflate, pngFromIdat, pngFromSamples, rowBytes } from "./png";
import { ocrEnabled, type Ocr } from "./ocr";

export type Method = "PDF_TEXT" | "OCR" | "DOCX" | "XLSX" | "TEXT" | "NONE";
export interface Extracted {
  method: Method;
  text: string;
  pages?: number;
  /** shown to admins when only part of a file could be read */
  note?: string;
}

const MAX_IMAGE_PIXELS = 60_000_000;
const MAX_OCR_IMAGE_BYTES = 20 * 1024 * 1024;

const utf8 = new TextDecoder("utf-8", { fatal: false });

/**
 * The largest image on each of the first pages of a PDF, as JPEG or PNG bytes tesseract can read.
 * Scanners store pages as JPEG (DCTDecode) or Flate-compressed gray/RGB; other encodings
 * (CCITT fax, JBIG2, JPEG 2000) are counted as unreadable.
 */
export async function scannedPageImages(bytes: Uint8Array, maxPages = MAX_OCR_PAGES) {
  const { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray, PDFNumber } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const num = (d: PDFDictT, key: string) => {
    const v = d.lookup(PDFName.of(key));
    return v instanceof PDFNumber ? v.asNumber() : undefined;
  };
  const images: Uint8Array[] = [];
  let unreadable = 0;
  for (const page of doc.getPages().slice(0, maxPages)) {
    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    let best: { area: number; stream: PDFRawStreamT } | null = null;
    for (const [, ref] of xobjects?.entries() ?? []) {
      const obj = doc.context.lookup(ref);
      if (!(obj instanceof PDFRawStream) || obj.dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
      const area = (num(obj.dict, "Width") ?? 0) * (num(obj.dict, "Height") ?? 0);
      if (!best || area > best.area) best = { area, stream: obj };
    }
    if (!best) continue;
    const d = best.stream.dict;
    const filterObj = d.lookup(PDFName.of("Filter"));
    const filters = filterObj instanceof PDFArray ? filterObj.asArray() : filterObj ? [filterObj] : [];
    const filter = filters.length === 1 ? filters[0].toString() : filters.map(String).join(",");
    const width = num(d, "Width") ?? 0;
    const height = num(d, "Height") ?? 0;
    if (!width || !height || width * height > MAX_IMAGE_PIXELS) {
      unreadable++;
      continue;
    }
    if (filter === "/DCTDecode") {
      images.push(best.stream.contents);
      continue;
    }
    if (filter !== "/FlateDecode") {
      unreadable++;
      continue;
    }
    // colour space: gray or RGB, directly or through an ICC profile
    let cs = d.lookup(PDFName.of("ColorSpace"));
    let channels: number | undefined;
    if (cs instanceof PDFArray && cs.lookup(0)?.toString() === "/ICCBased") {
      const icc = cs.lookup(1);
      channels = icc instanceof PDFRawStream ? num(icc.dict, "N") : undefined;
      cs = undefined;
    }
    if (cs === PDFName.of("DeviceGray")) channels = 1;
    else if (cs === PDFName.of("DeviceRGB")) channels = 3;
    if (d.lookup(PDFName.of("ImageMask"))?.toString() === "true") channels = 1;
    const bits = num(d, "BitsPerComponent") ?? 1;
    if ((channels !== 1 && channels !== 3) || (bits !== 1 && bits !== 8) || (bits === 1 && channels !== 1)) {
      unreadable++;
      continue;
    }
    const img = { width, height, bitDepth: bits as 1 | 8, channels: channels as 1 | 3 };
    const parms = d.lookup(PDFName.of("DecodeParms"));
    const predictor = parms instanceof PDFDict ? (num(parms, "Predictor") ?? 1) : 1;
    try {
      if (predictor >= 10) {
        // PNG predictors: the stream is already a valid PNG IDAT
        images.push(pngFromIdat(img, best.stream.contents));
      } else if (predictor === 1) {
        const decode = d.lookup(PDFName.of("Decode"));
        const invert = decode instanceof PDFArray && (decode.lookup(0) as PDFNumberT | undefined)?.asNumber?.() === 1;
        const samples = inflate(best.stream.contents, rowBytes(img) * height);
        images.push(pngFromSamples(img, samples, invert));
      } else unreadable++;
    } catch {
      unreadable++;
    }
  }
  return { images, unreadable, pageCount: doc.getPageCount() };
}

/** Reads the text of a stored file. `ocr` is started lazily, only when a file needs it. */
export async function extractText(bytes: Uint8Array, fileName: string, contentType: string, ocr: () => Promise<Ocr>): Promise<Extracted> {
  const kind = extractorFor(fileName, contentType);
  if (kind === "docx") return { method: "DOCX", text: normalizeText(readDocx(bytes)) };
  if (kind === "xlsx") return { method: "XLSX", text: normalizeText(readXlsx(bytes)) };
  if (kind === "text") return { method: "TEXT", text: normalizeText(utf8.decode(bytes)) };
  if (kind === "image") {
    if (!ocrEnabled()) return { method: "NONE", text: "", note: "OCR is turned off" };
    if (bytes.length > MAX_OCR_IMAGE_BYTES) return { method: "NONE", text: "", note: "Image too large for OCR" };
    return { method: "OCR", text: normalizeText(await (await ocr()).read(bytes)), pages: 1 };
  }
  if (kind !== "pdf") return { method: "NONE", text: "" };

  const { pageCount, pages } = await readPdfText(bytes);
  const pageTexts = pages.map((items) => items.map((i) => i.str).join(" "));
  const layer = pageTexts.join("\n");
  if (!needsOcr(pageTexts)) return { method: "PDF_TEXT", text: normalizeText(layer), pages: pageCount };
  if (!ocrEnabled()) return { method: "PDF_TEXT", text: normalizeText(layer), pages: pageCount, note: "Looks scanned, but OCR is turned off" };

  const { images, unreadable } = await scannedPageImages(bytes);
  if (!images.length) {
    return { method: "PDF_TEXT", text: normalizeText(layer), pages: pageCount, note: unreadable ? "Scanned pages use an image format OCR can't read" : undefined };
  }
  const engine = await ocr();
  const read: string[] = [];
  for (const image of images) read.push(await engine.read(image));
  const notes = [
    pageCount > MAX_OCR_PAGES ? `OCR covered the first ${MAX_OCR_PAGES} of ${pageCount} pages` : "",
    unreadable ? `${unreadable} page(s) use an image format OCR can't read` : "",
  ].filter(Boolean);
  return { method: "OCR", text: normalizeText(`${layer}\n${read.join("\n")}`), pages: pageCount, note: notes.join("; ") || undefined };
}
