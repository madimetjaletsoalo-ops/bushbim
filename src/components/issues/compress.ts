// Browser-only: re-encodes a photo as a JPEG at most PHOTO_MAX_WIDTH wide, plus a
// thumbnail, before upload. Keeps site uploads small on slow rural connections.
import { PHOTO_MAX_WIDTH, PHOTO_QUALITY, THUMB_MAX_WIDTH, THUMB_QUALITY, fitWidth } from "@/modules/issues/media";

export type Compressed = { photo: Blob; thumb: Blob; width: number; height: number };

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // honour the camera's EXIF orientation so portrait shots stay upright
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall back to <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(source: CanvasImageSource, w: number, h: number, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  // JPEG has no transparency: paint white under PNGs with alpha
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.imageSmoothingQuality = "high";
  g.drawImage(source, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't compress the photo."))), "image/jpeg", quality));
}

export async function compressPhoto(file: Blob): Promise<Compressed> {
  let img: ImageBitmap | HTMLImageElement;
  try {
    img = await decode(file);
  } catch {
    throw new Error("This browser can't read that image. Use a JPEG or PNG photo.");
  }
  const srcW = "naturalWidth" in img ? img.naturalWidth : img.width;
  const srcH = "naturalHeight" in img ? img.naturalHeight : img.height;
  const big = fitWidth(srcW, srcH, PHOTO_MAX_WIDTH);
  const small = fitWidth(srcW, srcH, THUMB_MAX_WIDTH);
  if (!big.w) throw new Error("That image is empty.");
  const [photo, thumb] = await Promise.all([encode(img, big.w, big.h, PHOTO_QUALITY), encode(img, small.w, small.h, THUMB_QUALITY)]);
  if ("close" in img) img.close();
  return { photo, thumb, width: big.w, height: big.h };
}
