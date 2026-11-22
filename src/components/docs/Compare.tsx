"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { btnGhost } from "@/components/ui";
import { overlayPixels } from "@/modules/docs/sheets";

type Side = { label: string; src: string; page: number; kind: "pdf" | "image"; title: string };
type Mode = "side" | "overlay";

/** Renders one page (or an image) of a file to a canvas `width` CSS px wide; returns the canvas. */
async function renderTo(side: Side, width: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (side.kind === "image") {
    const img = new Image();
    img.src = side.src;
    await img.decode();
    const scale = (width * dpr) / img.naturalWidth;
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ url: side.src }).promise;
  try {
    const page = await doc.getPage(Math.min(Math.max(1, side.page), doc.numPages));
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (width * dpr) / base.width });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas;
  } finally {
    void doc.destroy();
  }
}

export function Compare({ a, b, backHref, title }: { a: Side; b: Side; backHref: string; title: string }) {
  const [mode, setMode] = useState<Mode>("side");
  const wrapRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // the status belongs to the mode that produced it, so switching modes reads as "loading" at once
  const [result, setResult] = useState<{ mode: Mode; status: "ready" | "error" } | null>(null);
  const status = result && result.mode === mode ? result.status : "loading";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const total = wrapRef.current!.clientWidth;
        if (mode === "side") {
          const half = total >= 768 ? (total - 16) / 2 : total; // stacked on phones
          const [ca, cb] = await Promise.all([renderTo(a, half), renderTo(b, half)]);
          if (cancelled) return;
          for (const [host, c] of [[leftRef.current!, ca], [rightRef.current!, cb]] as const) {
            c.style.width = "100%";
            c.dataset.testid = "compare-canvas";
            host.replaceChildren(c);
          }
        } else {
          const ca = await renderTo(a, total);
          const cb = await renderTo(b, total);
          if (cancelled) return;
          // draw B at A's size so the two line up even if the pages differ slightly
          const out = document.createElement("canvas");
          out.width = ca.width;
          out.height = ca.height;
          const scratch = document.createElement("canvas");
          scratch.width = ca.width;
          scratch.height = ca.height;
          scratch.getContext("2d")!.drawImage(cb, 0, 0, ca.width, ca.height);
          const da = ca.getContext("2d")!.getImageData(0, 0, ca.width, ca.height).data;
          const db = scratch.getContext("2d")!.getImageData(0, 0, ca.width, ca.height).data;
          const ctx = out.getContext("2d")!;
          const img = ctx.createImageData(ca.width, ca.height);
          overlayPixels(da, db, img.data);
          ctx.putImageData(img, 0, 0);
          out.style.width = "100%";
          out.dataset.testid = "overlay-canvas";
          overlayRef.current!.replaceChildren(out);
        }
        setResult({ mode, status: "ready" });
      } catch (e) {
        console.error(e);
        if (!cancelled) setResult({ mode, status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, a, b]);

  const tab = (m: Mode, text: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`px-3 py-1.5 text-sm font-medium ${mode === m ? "bg-brand text-white" : "bg-surface hover:bg-muted"}`}
    >
      {text}
    </button>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-3 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={backHref} className={btnGhost}>← Back</Link>
        <h2 className="min-w-0 truncate text-lg font-semibold">Compare · {title}</h2>
        <div className="ml-auto flex overflow-hidden rounded-md border border-line" role="group" aria-label="Comparison mode">
          {tab("side", "Side by side")}
          {tab("overlay", "Overlay")}
        </div>
      </div>
      {mode === "overlay" && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="overlay-legend">
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-[#ff0000] align-middle" /> Only in {a.label} (removed)</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-[#0000ff] align-middle" /> Only in {b.label} (added)</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-black align-middle" /> Unchanged</span>
        </p>
      )}
      {status === "loading" && <p className="text-sm text-ink-soft">Rendering…</p>}
      {status === "error" && <p role="alert" className="text-sm text-red-800">These files couldn&apos;t be compared.</p>}
      <div ref={wrapRef} data-testid="compare-area" data-status={status} data-mode={mode}>
        {mode === "side" ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[
              [a, leftRef],
              [b, rightRef],
            ].map(([s, ref]) => {
              const side = s as Side;
              return (
                <figure key={side.label} className="min-w-0">
                  <figcaption className="mb-1 truncate text-sm font-medium" title={side.title}>
                    {side.label} · {side.title}
                  </figcaption>
                  <div ref={ref as React.RefObject<HTMLDivElement>} className="border border-line bg-white" />
                </figure>
              );
            })}
          </div>
        ) : (
          <div ref={overlayRef} className="border border-line bg-white" />
        )}
      </div>
    </div>
  );
}
