// pdf.js ships no types for its worker module; we only pass it to pdf.js as globalThis.pdfjsWorker.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
