// Minimal PNG writer for OCR: wraps image samples taken out of a scanned PDF
// (Flate-compressed gray/RGB) so tesseract can read them. Pure, unit-tested.
import { unzlibSync, zlibSync } from "fflate";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

export interface PngImage {
  width: number;
  height: number;
  /** 1 or 8 */
  bitDepth: 1 | 8;
  /** 1 = gray, 3 = RGB */
  channels: 1 | 3;
}

/** Bytes per row of unfiltered samples. */
export const rowBytes = (img: PngImage) => Math.ceil((img.width * img.channels * img.bitDepth) / 8);

/** Builds a PNG from a zlib stream whose rows already start with a PNG filter byte. */
export function pngFromIdat(img: PngImage, idat: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, img.width);
  v.setUint32(4, img.height);
  ihdr[8] = img.bitDepth;
  ihdr[9] = img.channels === 3 ? 2 : 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Builds a PNG from raw (unpredicted) samples, as a PDF stores them with only FlateDecode.
 * `invert` flips the samples, for images with /Decode [1 0].
 */
export function pngFromSamples(img: PngImage, samples: Uint8Array, invert = false): Uint8Array {
  const rb = rowBytes(img);
  if (samples.length < rb * img.height) throw new Error("Image data is shorter than its size");
  const filtered = new Uint8Array((rb + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    const row = samples.subarray(y * rb, y * rb + rb);
    const at = y * (rb + 1) + 1;
    if (invert) for (let i = 0; i < rb; i++) filtered[at + i] = 255 - row[i];
    else filtered.set(row, at);
  }
  return pngFromIdat(img, zlibSync(filtered, { level: 6 }));
}

/** Decompresses a PDF FlateDecode stream into at most `size` bytes (so a crafted stream can't balloon). */
export const inflate = (bytes: Uint8Array, size: number) => unzlibSync(bytes, { out: new Uint8Array(size) });
