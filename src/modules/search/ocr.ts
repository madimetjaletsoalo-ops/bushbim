import "server-only";
import os from "node:os";
import path from "node:path";

// OCR with tesseract (WebAssembly build, so it runs on Vercel without a system binary).
// English data ships in node_modules/@tesseract.js-data/eng; set OCR=off to skip OCR.

export const ocrEnabled = () => process.env.OCR !== "off";

type Worker = { recognize(image: Uint8Array | Buffer): Promise<{ data: { text: string } }>; terminate(): Promise<unknown> };

export interface Ocr {
  read(image: Uint8Array): Promise<string>;
  close(): Promise<void>;
}

/** Starts one tesseract worker, reused for every page of a batch. Close it when done. */
export async function startOcr(): Promise<Ocr> {
  const { createWorker } = await import("tesseract.js");
  const worker = (await createWorker("eng", 1, {
    langPath: path.join(process.cwd(), "node_modules/@tesseract.js-data/eng/4.0.0"),
    cachePath: path.join(os.tmpdir(), "bushbim-tesseract"),
    gzip: true,
  })) as unknown as Worker;
  return {
    async read(image) {
      const r = await worker.recognize(Buffer.from(image));
      return r.data.text ?? "";
    },
    async close() {
      await worker.terminate().catch(() => {});
    },
  };
}
