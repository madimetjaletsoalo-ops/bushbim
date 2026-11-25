// Pure helpers for issue pins and photos: limits, sizes, JPEG checks and pin input.
// No database or browser imports, so everything here is unit tested.
import { z } from "zod";

/** Photos are re-encoded in the browser as JPEG at most this many pixels wide. */
export const PHOTO_MAX_WIDTH = 1600;
/** Gallery and issue thumbnails, so lists load fast on slow rural connections. */
export const THUMB_MAX_WIDTH = 320;
export const PHOTO_QUALITY = 0.8;
export const THUMB_QUALITY = 0.7;
/** A 1600 px JPEG at quality 0.8 is usually 200–600 KB; anything far above is not one of ours. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_THUMB_BYTES = 256 * 1024;
export const MAX_PHOTOS_PER_UPLOAD = 10;
export const MAX_CAPTION = 200;
export const GALLERY_PAGE_SIZE = 48;

/** Scales (w, h) down so the width is at most maxWidth, keeping the aspect ratio. Never scales up. */
export function fitWidth(w: number, h: number, maxWidth: number): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  if (w <= maxWidth) return { w: Math.round(w), h: Math.round(h) };
  return { w: maxWidth, h: Math.max(1, Math.round((h * maxWidth) / w)) };
}

/**
 * Width and height of a baseline or progressive JPEG, read from its SOF marker.
 * Returns null if the bytes aren't a JPEG. Used server-side to check that an
 * upload really is a compressed photo within the size limit.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    // fill bytes and standalone markers have no length
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame header
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null;
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 8 >= bytes.length) return null;
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

/** "IMG_2041.HEIC" → "IMG_2041.jpg": the stored file is always a JPEG. */
export function photoFileName(original: string): string {
  const base = original
    .normalize("NFC")
    .replace(/\.[a-z0-9]{1,10}$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${base || "photo"}.jpg`;
}

export const photoKeys = (projectId: string, random: string) => ({
  key: `projects/${projectId}/photos/${random}.jpg`,
  thumbKey: `projects/${projectId}/photos/${random}_t.jpg`,
});

export const photoSpec = z.object({
  name: z.string().max(400),
  size: z.number().int().positive().max(MAX_PHOTO_BYTES, "Photos must be compressed before upload."),
  thumbSize: z.number().int().positive().max(MAX_THUMB_BYTES, "Thumbnail is too large."),
});
export type PhotoSpec = z.infer<typeof photoSpec>;

/** A photo row is acceptable once stored if it is a JPEG no wider than the limit. */
export function checkStoredPhoto(dims: { width: number; height: number } | null, maxWidth = PHOTO_MAX_WIDTH): string | null {
  if (!dims) return "That file isn't a JPEG photo.";
  if (dims.width > maxWidth) return `Photos must be at most ${maxWidth} px wide.`;
  return null;
}

// ---------- pins ----------

/** A pin position on a page: page units, as used by markups. */
export const pinSchema = z.object({
  versionId: z.string().min(1).max(64),
  page: z.coerce.number().int().min(1).max(10000),
  x: z.coerce.number().finite().min(0).max(100000),
  y: z.coerce.number().finite().min(0).max(100000),
});
export type PinInput = z.infer<typeof pinSchema>;

/** Reads optional pin fields from a form; null when no pin was given, an error when they're malformed. */
export function readPinFields(get: (k: string) => string): PinInput | null | { error: string } {
  const versionId = get("pinVersionId");
  if (!versionId) return null;
  const parsed = pinSchema.safeParse({ versionId, page: get("pinPage"), x: get("pinX"), y: get("pinY") });
  if (!parsed.success) return { error: "The pin position is invalid. Place it again from the viewer." };
  return { ...parsed.data, x: Math.round(parsed.data.x * 100) / 100, y: Math.round(parsed.data.y * 100) / 100 };
}

/** Query string for "New issue here" from the viewer. */
export const pinQuery = (p: PinInput) => `pinVersionId=${encodeURIComponent(p.versionId)}&pinPage=${p.page}&pinX=${p.x}&pinY=${p.y}`;

/** Pins carry the status colour; closed issues are drawn faded so open work stands out. */
export function pinStyle(status: { color: string; closed: boolean }) {
  return { fill: status.color, opacity: status.closed ? 0.55 : 1 };
}

/** Who can remove a photo: the uploader, or an Issues Manager / project admin. */
export const canDeletePhoto = (photo: { uploadedById: string | null }, userId: string, manager: boolean) =>
  manager || (!!photo.uploadedById && photo.uploadedById === userId);
