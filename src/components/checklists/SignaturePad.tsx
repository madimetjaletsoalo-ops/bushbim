"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { btn, btnGhost } from "@/components/ui";

const W = 480;
const H = 160;

/**
 * Draw-to-sign pad for touch screens and mice. The drawing goes into a hidden `value`
 * input as a small PNG data URL (usually 5–20 KB) when the form is submitted.
 */
export function SignaturePad({ name = "value", label }: { name?: string; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [data, setData] = useState("");
  const empty = !data;
  const { pending } = useFormStatus();

  useEffect(() => {
    const g = canvas.current?.getContext("2d");
    if (!g) return;
    g.lineWidth = 2.5;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#111827";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  };
  const sync = () => {
    if (canvas.current) setData(canvas.current.toDataURL("image/png"));
  };
  const clear = () => {
    canvas.current?.getContext("2d")?.clearRect(0, 0, W, H);
    setData("");
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        width={W}
        height={H}
        aria-label={label}
        role="img"
        data-testid="signature-pad"
        className="block w-full max-w-md touch-none rounded-md border border-dashed border-line bg-white"
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const g = e.currentTarget.getContext("2d")!;
          const p = point(e);
          g.beginPath();
          g.moveTo(p.x, p.y);
          // a tap leaves a dot
          g.lineTo(p.x + 0.1, p.y + 0.1);
          g.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const g = e.currentTarget.getContext("2d")!;
          const p = point(e);
          g.lineTo(p.x, p.y);
          g.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          sync();
        }}
        onPointerCancel={() => {
          drawing.current = false;
          sync();
        }}
      />
      <input type="hidden" name={name} value={data} />
      <div className="flex gap-2">
        <button type="submit" className={btn} disabled={empty || pending}>
          {pending ? "Saving…" : "Save signature"}
        </button>
        <button type="button" className={btnGhost} onClick={clear} disabled={empty || pending}>
          Clear
        </button>
      </div>
    </div>
  );
}
