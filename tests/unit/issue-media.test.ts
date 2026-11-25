import { describe, expect, it } from "vitest";
import {
  MAX_PHOTO_BYTES,
  PHOTO_MAX_WIDTH,
  THUMB_MAX_WIDTH,
  canDeletePhoto,
  checkStoredPhoto,
  fitWidth,
  jpegSize,
  photoFileName,
  photoKeys,
  photoSpec,
  pinQuery,
  pinSchema,
  pinStyle,
  readPinFields,
} from "@/modules/issues/media";

/** Minimal JPEG header: SOI, an APP0 segment, then a frame header with the given marker. */
function jpeg(width: number, height: number, sof = 0xc0, extra: number[] = []) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const frame = [0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...extra, ...frame, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
}

describe("fitWidth", () => {
  it("scales wide photos down to the limit, keeping the aspect ratio", () => {
    expect(fitWidth(4032, 3024, PHOTO_MAX_WIDTH)).toEqual({ w: 1600, h: 1200 });
    expect(fitWidth(3024, 4032, PHOTO_MAX_WIDTH)).toEqual({ w: 1600, h: 2133 });
    expect(fitWidth(4032, 3024, THUMB_MAX_WIDTH)).toEqual({ w: 320, h: 240 });
  });
  it("never scales up and rejects empty sizes", () => {
    expect(fitWidth(800, 600, PHOTO_MAX_WIDTH)).toEqual({ w: 800, h: 600 });
    expect(fitWidth(1600, 10, PHOTO_MAX_WIDTH)).toEqual({ w: 1600, h: 10 });
    expect(fitWidth(0, 600, PHOTO_MAX_WIDTH)).toEqual({ w: 0, h: 0 });
    expect(fitWidth(100000, 1, PHOTO_MAX_WIDTH).h).toBe(1);
  });
});

describe("jpegSize", () => {
  it("reads width and height from baseline and progressive frame headers", () => {
    expect(jpegSize(jpeg(1600, 1200))).toEqual({ width: 1600, height: 1200 });
    expect(jpegSize(jpeg(320, 2133, 0xc2))).toEqual({ width: 320, height: 2133 });
  });
  it("skips other segments such as Huffman tables before the frame", () => {
    const dht = [0xff, 0xc4, 0x00, 0x04, 0x00, 0x00];
    expect(jpegSize(jpeg(1024, 768, 0xc0, dht))).toEqual({ width: 1024, height: 768 });
  });
  it("rejects files that aren't JPEGs or are cut short", () => {
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBeNull();
    expect(jpegSize(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(jpegSize(jpeg(100, 100).slice(0, 26))).toBeNull();
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]))).toBeNull();
  });
});

describe("checkStoredPhoto", () => {
  it("accepts JPEGs up to the width limit and refuses wider or non-JPEG files", () => {
    expect(checkStoredPhoto({ width: 1600, height: 3000 })).toBeNull();
    expect(checkStoredPhoto({ width: 1601, height: 900 })).toMatch(/1600 px/);
    expect(checkStoredPhoto(null)).toMatch(/isn't a JPEG/);
    expect(checkStoredPhoto({ width: 400, height: 300 }, THUMB_MAX_WIDTH)).toMatch(/320 px/);
  });
});

describe("photo names, keys and specs", () => {
  it("always stores a .jpg with a safe name", () => {
    expect(photoFileName("IMG_2041.HEIC")).toBe("IMG_2041.jpg");
    expect(photoFileName("villa 3/pool:deck.png")).toBe("villa 3_pool_deck.jpg");
    expect(photoFileName(".jpg")).toBe("photo.jpg");
    expect(photoFileName("x".repeat(300) + ".jpg")).toHaveLength(124);
  });
  it("keeps photo and thumbnail keys under the project", () => {
    expect(photoKeys("p1", "abc")).toEqual({ key: "projects/p1/photos/abc.jpg", thumbKey: "projects/p1/photos/abc_t.jpg" });
  });
  it("refuses uncompressed uploads", () => {
    expect(photoSpec.safeParse({ name: "a.jpg", size: 300_000, thumbSize: 20_000 }).success).toBe(true);
    expect(photoSpec.safeParse({ name: "a.jpg", size: MAX_PHOTO_BYTES + 1, thumbSize: 20_000 }).success).toBe(false);
    expect(photoSpec.safeParse({ name: "a.jpg", size: 0, thumbSize: 20_000 }).success).toBe(false);
  });
});

describe("pins", () => {
  it("validates positions", () => {
    expect(pinSchema.safeParse({ versionId: "v1", page: 2, x: 10.5, y: 300 }).success).toBe(true);
    expect(pinSchema.safeParse({ versionId: "v1", page: 0, x: 1, y: 1 }).success).toBe(false);
    expect(pinSchema.safeParse({ versionId: "v1", page: 1, x: -1, y: 1 }).success).toBe(false);
    expect(pinSchema.safeParse({ versionId: "", page: 1, x: 1, y: 1 }).success).toBe(false);
    expect(pinSchema.safeParse({ versionId: "v1", page: 1, x: Number.NaN, y: 1 }).success).toBe(false);
  });
  it("reads optional pin fields from the new issue form and round-trips the viewer link", () => {
    const fields = (q: string) => {
      const sp = new URLSearchParams(q);
      return (k: string) => sp.get(k) ?? "";
    };
    expect(readPinFields(fields(""))).toBeNull();
    const q = pinQuery({ versionId: "v 1", page: 3, x: 12.345, y: 67.891 });
    expect(readPinFields(fields(q))).toEqual({ versionId: "v 1", page: 3, x: 12.35, y: 67.89 });
    expect(readPinFields(fields("pinVersionId=v1&pinPage=abc&pinX=1&pinY=1"))).toEqual({ error: expect.stringMatching(/invalid/) });
  });
  it("draws pins in the status colour, faded once closed", () => {
    expect(pinStyle({ color: "#f59e0b", closed: false })).toEqual({ fill: "#f59e0b", opacity: 1 });
    expect(pinStyle({ color: "#16a34a", closed: true }).opacity).toBeLessThan(1);
  });
});

describe("canDeletePhoto", () => {
  it("lets the uploader or a Manager delete", () => {
    expect(canDeletePhoto({ uploadedById: "u1" }, "u1", false)).toBe(true);
    expect(canDeletePhoto({ uploadedById: "u1" }, "u2", false)).toBe(false);
    expect(canDeletePhoto({ uploadedById: null }, "u2", false)).toBe(false);
    expect(canDeletePhoto({ uploadedById: null }, "u2", true)).toBe(true);
  });
});
