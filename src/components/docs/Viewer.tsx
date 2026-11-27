"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { badge, btn, btnDanger, btnGhost, input } from "@/components/ui";
import { createMarkup, deleteMarkup, setCalibration, setMarkupStatus, type MarkupDTO } from "@/modules/docs/markup-actions";
import { placePin } from "@/modules/issues/media-actions";
import { pinQuery, pinStyle } from "@/modules/issues/media";
import {
  MARKUP_COLORS,
  UNITS,
  distance,
  labelAnchor,
  markupPath,
  measureLabel,
  simplify,
  type MarkupType,
  type Pt,
} from "@/modules/docs/markup";

type Tool = "PAN" | MarkupType | "CALIBRATE" | "PIN";
type Scale = { page: number; unitsPerPoint: number; unit: string };
type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "PAN", label: "Select", hint: "Scroll and select" },
  { id: "PEN", label: "Pen", hint: "Drag to draw" },
  { id: "RECT", label: "Rectangle", hint: "Drag a box" },
  { id: "CLOUD", label: "Cloud", hint: "Drag a revision cloud" },
  { id: "ARROW", label: "Arrow", hint: "Drag from tail to tip" },
  { id: "TEXT", label: "Text", hint: "Click where the text goes" },
  { id: "LENGTH", label: "Length", hint: "Click points, then Finish" },
  { id: "AREA", label: "Area", hint: "Click 3+ corners, then Finish" },
  { id: "CALIBRATE", label: "Set scale", hint: "Drag along a known dimension" },
  { id: "PIN", label: "Pin issue", hint: "Click where the issue is" },
];

/** An issue pinned on this version, drawn in its status colour. */
export type PinView = { issueId: string; number: number; title: string; page: number; x: number; y: number; color: string; closed: boolean; statusName: string };
/** Issues the member may pin (or move the pin of). */
export type PinnableIssue = { id: string; number: number; title: string; color: string; closed: boolean; statusName: string; pinnedHere: boolean; pinnedElsewhere: boolean };
const TYPE_LABEL: Record<string, string> = { PEN: "Pen", RECT: "Rectangle", CLOUD: "Cloud", ARROW: "Arrow", TEXT: "Text", LENGTH: "Length", AREA: "Area" };

interface Props {
  projectId: string;
  versionId: string;
  name: string;
  versionNumber: number;
  versions: { id: string; number: number; href: string }[];
  kind: "pdf" | "image";
  src: string;
  exportHref: string | null;
  backHref: string;
  me: string;
  canPublish: boolean;
  canCalibrate: boolean;
  canManage: boolean;
  initialMarkups: MarkupDTO[];
  initialScales: Scale[];
  initialPage?: number;
  /** compare page for the previous version; the current page numbers are appended */
  compareBase?: string | null;
  /** issue pins on this version (only when the member has Issues access) */
  pins?: PinView[];
  /** issues the member can pin; null hides the Pin tool */
  pinnable?: PinnableIssue[] | null;
  /** issue to highlight and scroll to (?pin=) */
  focusPin?: string | null;
}

export function Viewer(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const renderRef = useRef<{ cancel(): void } | null>(null);

  const [numPages, setNumPages] = useState(1);
  const [page, setPage] = useState(p.initialPage ?? 1);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitted, setFitted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("PAN");
  const [color, setColor] = useState<string>(MARKUP_COLORS[0]);
  const [markups, setMarkups] = useState<MarkupDTO[]>(p.initialMarkups);
  const [scales, setScales] = useState<Scale[]>(p.initialScales);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [textAt, setTextAt] = useState<Pt | null>(null);
  const [textValue, setTextValue] = useState("");
  const [calib, setCalib] = useState<{ a: Pt; b: Pt } | null>(null);
  const [calibValue, setCalibValue] = useState("");
  const [calibUnit, setCalibUnit] = useState<string>("m");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dragging = useRef(false);
  const [pins, setPins] = useState<PinView[]>(p.pins ?? []);
  const [pinnable, setPinnable] = useState<PinnableIssue[]>(p.pinnable ?? []);
  const [pinAt, setPinAt] = useState<Pt | null>(null);
  const [pinIssue, setPinIssue] = useState("");
  const [focus, setFocus] = useState<string | null>(p.focusPin ?? null);

  const scale = scales.find((s) => s.page === page) ?? null;
  const pageMarkups = useMemo(() => markups.filter((m) => m.page === page), [markups, page]);
  const pagePins = useMemo(() => pins.filter((x) => x.page === page), [pins, page]);
  const issuesBase = `/projects/${p.projectId}/issues`;

  // ---------- loading and rendering ----------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (p.kind === "image") {
          const img = new Image();
          img.src = p.src;
          await img.decode();
          if (!cancelled) setSize({ w: img.naturalWidth, h: img.naturalHeight });
          return;
        }
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const doc = await pdfjs.getDocument({ url: p.src, disableRange: true }).promise;
        if (cancelled) return void doc.destroy();
        docRef.current = doc;
        setNumPages(doc.numPages);
        setPage((pg) => Math.min(pg, doc.numPages));
      } catch (e) {
        console.error(e);
        if (!cancelled) setLoadError("This file couldn't be opened in the viewer.");
      }
    })();
    return () => {
      cancelled = true;
      void docRef.current?.destroy();
      docRef.current = null;
    };
  }, [p.kind, p.src]);

  useEffect(() => {
    if (p.kind !== "pdf") return;
    let cancelled = false;
    const tick = async () => {
      const doc = docRef.current;
      if (!doc || !canvasRef.current) return;
      const pg = await doc.getPage(page);
      const base = pg.getViewport({ scale: 1 });
      if (cancelled) return;
      setSize((s) => (s && s.w === base.width && s.h === base.height ? s : { w: base.width, h: base.height }));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = pg.getViewport({ scale: zoom * dpr });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      renderRef.current?.cancel();
      const task = pg.render({ canvasContext: canvas.getContext("2d")!, viewport: vp });
      renderRef.current = task;
      try {
        await task.promise;
        canvas.dataset.renderedPage = String(page);
      } catch {
        /* superseded by a newer render */
      }
    };
    const id = window.setInterval(() => {
      if (docRef.current) {
        window.clearInterval(id);
        void tick();
      }
    }, 30);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [p.kind, page, zoom, numPages]);

  // fit the page width to the screen the first time its size is known
  useEffect(() => {
    if (!size || fitted || !wrapRef.current) return;
    const avail = wrapRef.current.clientWidth - 16;
    setZoom(Math.max(0.1, Math.min(4, avail / size.w)));
    setFitted(true);
  }, [size, fitted]);

  // bring the pin from ?pin= into view once the page is fitted
  useEffect(() => {
    if (!fitted || !focus || !wrapRef.current) return;
    const pin = pins.find((x) => x.issueId === focus && x.page === page);
    if (!pin) return;
    const el = wrapRef.current;
    el.scrollTo({ left: Math.max(0, pin.x * zoom - el.clientWidth / 2), top: Math.max(0, pin.y * zoom - el.clientHeight / 2) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitted, focus]);

  // ---------- drawing ----------

  const toPage = useCallback(
    (e: { clientX: number; clientY: number }): Pt => {
      const r = svgRef.current!.getBoundingClientRect();
      return [+((e.clientX - r.left) / zoom).toFixed(2), +((e.clientY - r.top) / zoom).toFixed(2)];
    },
    [zoom],
  );

  const resetDraft = () => {
    setDraft([]);
    dragging.current = false;
  };

  async function save(type: MarkupType, points: Pt[], text?: string) {
    setBusy(true);
    setError(null);
    const res = await createMarkup(p.projectId, p.versionId, { page, type, points, color, text });
    setBusy(false);
    if (res.ok) setMarkups((ms) => [...ms, res.data]);
    else setError(res.error);
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (tool === "PAN" || textAt || calib || pinAt) return;
    e.preventDefault();
    const pt = toPage(e);
    if (tool === "PIN") {
      setPinAt(pt);
      setPinIssue("");
      return;
    }
    if (tool === "TEXT") {
      setTextAt(pt);
      setTextValue("");
      return;
    }
    if (tool === "LENGTH" || tool === "AREA") {
      setDraft((d) => [...d, pt]);
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragging.current = true;
    setDraft([pt, pt]);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragging.current) return;
    const pt = toPage(e);
    setDraft((d) => (tool === "PEN" ? [...d, pt] : [d[0], pt]));
  }

  async function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    const pts = tool === "PEN" ? simplify(draft) : draft;
    if (pts.length < 2 || distance(pts[0], pts[pts.length - 1]) < 3 / zoom) {
      if (tool !== "PEN" || pts.length < 2) return resetDraft();
    }
    if (tool === "CALIBRATE") {
      setCalib({ a: pts[0], b: pts[pts.length - 1] });
      setCalibValue("");
      setDraft([]);
      return;
    }
    setDraft([]);
    await save(tool as MarkupType, pts);
  }

  async function finishMeasure() {
    const min = tool === "AREA" ? 3 : 2;
    if (draft.length < min) return setError(tool === "AREA" ? "Click at least 3 corners." : "Click at least 2 points.");
    const pts = draft;
    setDraft([]);
    await save(tool as MarkupType, pts);
  }

  async function saveText() {
    if (!textAt || !textValue.trim()) return;
    const at = textAt;
    setTextAt(null);
    await save("TEXT", [at], textValue.trim());
  }

  async function savePin() {
    if (!pinAt || !pinIssue) return;
    setBusy(true);
    setError(null);
    const res = await placePin(p.projectId, pinIssue, { versionId: p.versionId, page, x: pinAt[0], y: pinAt[1] });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const issue = pinnable.find((i) => i.id === pinIssue)!;
    setPins((ps) => [
      ...ps.filter((x) => x.issueId !== pinIssue),
      { number: issue.number, title: issue.title, color: issue.color, closed: issue.closed, statusName: issue.statusName, ...res.data },
    ]);
    setPinnable((is) => is.map((i) => (i.id === pinIssue ? { ...i, pinnedHere: true, pinnedElsewhere: false } : i)));
    setFocus(pinIssue);
    setPinAt(null);
  }

  async function saveCalibration() {
    if (!calib) return;
    const value = Number(calibValue.replace(",", "."));
    if (!(value > 0)) return setError("Enter the real length of the line you drew.");
    setBusy(true);
    const res = await setCalibration(p.projectId, p.versionId, { page, a: calib.a, b: calib.b, distance: value, unit: calibUnit });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setScales((s) => [...s.filter((x) => x.page !== page), res.data]);
    setCalib(null);
    setTool("LENGTH");
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "Escape") {
        resetDraft();
        setTextAt(null);
        setCalib(null);
        setPinAt(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickTool = (t: Tool) => {
    resetDraft();
    setTextAt(null);
    setCalib(null);
    setPinAt(null);
    setError(null);
    setTool(t);
  };
  const goPage = (n: number) => {
    resetDraft();
    setTextAt(null);
    setCalib(null);
    setPinAt(null);
    setPage(Math.min(Math.max(1, n), numPages));
  };

  async function togglePublish(m: MarkupDTO) {
    const res = await setMarkupStatus(p.projectId, m.id, m.status === "PUBLISHED" ? "PRIVATE" : "PUBLISHED");
    if (res.ok) setMarkups((ms) => ms.map((x) => (x.id === m.id ? res.data : x)));
    else setError(res.error);
  }
  async function remove(m: MarkupDTO) {
    if (!window.confirm("Delete this markup?")) return;
    const res = await deleteMarkup(p.projectId, m.id);
    if (res.ok) setMarkups((ms) => ms.filter((x) => x.id !== m.id));
    else setError(res.error);
  }

  // ---------- render ----------

  const w = size ? size.w * zoom : 0;
  const h = size ? size.h * zoom : 0;

  const renderShape = (m: { type: string; points: Pt[]; color: string; text?: string | null }, key: string, opts: { draft?: boolean } = {}) => {
    if (m.type === "TEXT")
      return (
        <text key={key} x={m.points[0][0]} y={m.points[0][1] + 14} fill={m.color} fontSize={14} fontFamily="Helvetica, Arial, sans-serif" data-testid="markup-shape">
          {(m.text ?? "").split("\n").map((line, i) => (
            <tspan key={i} x={m.points[0][0]} dy={i ? 16 : 0}>{line}</tspan>
          ))}
        </text>
      );
    const measure = m.type === "LENGTH" || m.type === "AREA";
    const label = measure && m.points.length >= (m.type === "AREA" ? 3 : 2) ? measureLabel(m.type as "LENGTH" | "AREA", m.points, scale) : null;
    const anchor = label ? labelAnchor(m.type as "LENGTH" | "AREA", m.points) : null;
    return (
      <g key={key} data-testid={opts.draft ? undefined : "markup-shape"}>
        <path
          d={markupPath(m.type as MarkupType, m.points)}
          fill={m.type === "AREA" ? `${m.color}22` : "none"}
          stroke={m.color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={opts.draft ? `${6 / zoom} ${4 / zoom}` : undefined}
          vectorEffect="non-scaling-stroke"
        />
        {label && anchor && (
          <text x={anchor[0]} y={anchor[1]} fontSize={12 / zoom} textAnchor="middle" fill={m.color} stroke="white" strokeWidth={3 / zoom} paintOrder="stroke" data-testid="measure-label">
            {label}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col">
      <div className="sticky top-0 z-20 border-b border-line bg-surface px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={p.backHref} className={btnGhost}>← Folder</Link>
          <h2 className="min-w-0 max-w-full truncate text-sm font-semibold sm:max-w-xs" title={p.name}>{p.name}</h2>
          {p.versions.length > 1 ? (
            <select
              aria-label="Version"
              className={`${input} w-auto py-1`}
              value={p.versionId}
              onChange={(e) => (window.location.href = p.versions.find((v) => v.id === e.target.value)!.href)}
            >
              {p.versions.map((v) => <option key={v.id} value={v.id}>V{v.number}</option>)}
            </select>
          ) : (
            <span className={`${badge} bg-brand/10 text-brand`}>V{p.versionNumber}</span>
          )}
          <div className="ml-auto flex items-center gap-1" role="group" aria-label="Pages">
            <button type="button" className={btnGhost} onClick={() => goPage(page - 1)} disabled={page <= 1} aria-label="Previous page">‹</button>
            <span className="whitespace-nowrap px-1 text-sm" data-testid="page-indicator">Page {page} of {numPages}</span>
            <button type="button" className={btnGhost} onClick={() => goPage(page + 1)} disabled={page >= numPages} aria-label="Next page">›</button>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Zoom">
            <button type="button" className={btnGhost} onClick={() => setZoom((z) => Math.max(0.1, +(z / 1.25).toFixed(3)))} aria-label="Zoom out">−</button>
            <span className="w-12 text-center text-sm" data-testid="zoom-level">{Math.round(zoom * 100)}%</span>
            <button type="button" className={btnGhost} onClick={() => setZoom((z) => Math.min(8, +(z * 1.25).toFixed(3)))} aria-label="Zoom in">+</button>
            <button type="button" className={btnGhost} onClick={() => size && wrapRef.current && setZoom((wrapRef.current.clientWidth - 16) / size.w)}>Fit</button>
          </div>
          {p.compareBase && (
            <a href={`${p.compareBase}&pa=${page}&pb=${page}`} className={btnGhost}>Compare with V{p.versionNumber - 1}</a>
          )}
          {p.exportHref && (
            <a href={p.exportHref} className={btnGhost}>Export PDF</a>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1" role="toolbar" aria-label="Markup tools">
          {TOOLS.filter((t) => (t.id !== "CALIBRATE" || p.canCalibrate) && (t.id !== "PIN" || !!p.pinnable)).map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.hint}
              aria-pressed={tool === t.id}
              onClick={() => pickTool(t.id)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${tool === t.id ? "border-brand bg-brand text-white" : "border-line bg-surface hover:bg-muted"}`}
            >
              {t.label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          {MARKUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-ink" : "border-transparent"}`}
              style={{ background: c }}
            />
          ))}
          {(tool === "LENGTH" || tool === "AREA") && draft.length > 0 && (
            <>
              <button type="button" className={btn} onClick={finishMeasure} disabled={busy}>Finish</button>
              <button type="button" className={btnGhost} onClick={resetDraft}>Cancel</button>
            </>
          )}
          <span className="ml-auto text-xs text-ink-soft" data-testid="scale-status">
            {scale ? `Scale set (${scale.unit})` : "Scale not set"}
          </span>
        </div>
        {error && <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-1.5 text-sm text-red-800">{error}</p>}
      </div>

      <div className="flex flex-1 flex-col lg:flex-row">
        <div ref={wrapRef} className="relative min-h-[60vh] flex-1 overflow-auto bg-muted p-2" data-testid="viewer-canvas-wrap">
          {loadError && <p className="p-6 text-sm text-red-800">{loadError}</p>}
          {!size && !loadError && <p className="p-6 text-sm text-ink-soft">Loading…</p>}
          <div className="relative mx-auto shadow" style={{ width: w || undefined, height: h || undefined, visibility: size ? "visible" : "hidden" }}>
            {p.kind === "pdf" ? (
              <canvas ref={canvasRef} style={{ width: w, height: h }} className="block bg-white" data-testid="pdf-canvas" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.src} alt={p.name} style={{ width: w, height: h }} className="block select-none bg-white" draggable={false} />
            )}
            {size && (
              <svg
                ref={svgRef}
                data-testid="markup-layer"
                className="absolute inset-0"
                width={w}
                height={h}
                viewBox={`0 0 ${size.w} ${size.h}`}
                style={{ touchAction: tool === "PAN" ? "auto" : "none", cursor: tool === "PAN" ? "default" : "crosshair" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onDoubleClick={() => (tool === "LENGTH" || tool === "AREA") && void finishMeasure()}
              >
                {pageMarkups.map((m) => renderShape(m, m.id))}
                {draft.length > 0 && renderShape({ type: tool === "CALIBRATE" ? "LENGTH" : tool, points: draft, color }, "draft", { draft: true })}
                {calib && <path d={`M ${calib.a[0]} ${calib.a[1]} L ${calib.b[0]} ${calib.b[1]}`} stroke="#ef6c00" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                {pagePins.map((pin) => {
                  const r = 11 / zoom;
                  const st = pinStyle(pin);
                  const focused = focus === pin.issueId;
                  return (
                    <a key={pin.issueId} href={`${issuesBase}/${pin.issueId}`} aria-label={`Issue #${pin.number} ${pin.title}`} data-testid="issue-pin" data-color={pin.color} data-issue={pin.number}>
                      <title>{`#${pin.number} ${pin.title}${pin.statusName ? ` (${pin.statusName})` : ""}`}</title>
                      <g transform={`translate(${pin.x} ${pin.y})`} opacity={st.opacity}>
                        {focused && <circle cy={-r * 1.9} r={r * 1.7} fill="none" stroke={pin.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                        <path d={`M 0 0 L ${-r * 0.75} ${-r * 1.2} A ${r} ${r} 0 1 1 ${r * 0.75} ${-r * 1.2} Z`} fill={st.fill} stroke="white" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                        <text y={-r * 1.6} textAnchor="middle" fontSize={(pin.number > 99 ? 8 : 10) / zoom} fontWeight={700} fill="white" fontFamily="Helvetica, Arial, sans-serif">{pin.number}</text>
                      </g>
                    </a>
                  );
                })}
                {pinAt && <circle cx={pinAt[0]} cy={pinAt[1]} r={5 / zoom} fill="#ef6c00" data-testid="pin-draft" />}
              </svg>
            )}
            {pinAt && (
              <div className="absolute z-10 w-64 rounded-md border border-line bg-surface p-2 shadow-lg" data-testid="pin-form" style={{ left: Math.min(pinAt[0] * zoom, Math.max(0, w - 260)), top: pinAt[1] * zoom + 8 }}>
                <label className="mb-1 block text-xs font-medium" htmlFor="pin-issue">Issue to pin here</label>
                <select id="pin-issue" className={`${input} py-1`} value={pinIssue} onChange={(e) => setPinIssue(e.target.value)}>
                  <option value="">Choose an issue…</option>
                  {pinnable.map((i) => (
                    <option key={i.id} value={i.id}>
                      #{i.number} {i.title.length > 40 ? `${i.title.slice(0, 40)}…` : i.title}{i.pinnedHere || i.pinnedElsewhere ? " (moves its pin)" : ""}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={btn} onClick={savePin} disabled={!pinIssue || busy}>Pin issue</button>
                  <a className={btnGhost} href={`${issuesBase}/new?${pinQuery({ versionId: p.versionId, page, x: pinAt[0], y: pinAt[1] })}`}>New issue here</a>
                  <button type="button" className={btnGhost} onClick={() => setPinAt(null)}>Cancel</button>
                </div>
              </div>
            )}
            {textAt && (
              <div className="absolute z-10 w-56 rounded-md border border-line bg-surface p-2 shadow-lg" style={{ left: Math.min(textAt[0] * zoom, Math.max(0, w - 230)), top: textAt[1] * zoom }}>
                <textarea
                  autoFocus
                  aria-label="Markup text"
                  className={`${input} h-16`}
                  value={textValue}
                  maxLength={500}
                  onChange={(e) => setTextValue(e.target.value)}
                />
                <div className="mt-2 flex gap-2">
                  <button type="button" className={btn} onClick={saveText} disabled={!textValue.trim() || busy}>Add text</button>
                  <button type="button" className={btnGhost} onClick={() => setTextAt(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="border-t border-line bg-surface p-3 lg:w-80 lg:border-l lg:border-t-0" aria-label="Markups on this page">
          {calib && (
            <div className="mb-4 rounded-md border border-accent/40 bg-accent/5 p-3" data-testid="calibrate-form">
              <p className="text-sm font-medium">How long is the line you drew?</p>
              <div className="mt-2 flex gap-2">
                <input aria-label="Real length" inputMode="decimal" className={input} value={calibValue} onChange={(e) => setCalibValue(e.target.value)} autoFocus />
                <select aria-label="Unit" className={`${input} w-20`} value={calibUnit} onChange={(e) => setCalibUnit(e.target.value)}>
                  {UNITS.map((u) => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div className="mt-2 flex gap-2">
                <button type="button" className={btn} onClick={saveCalibration} disabled={busy}>Set scale</button>
                <button type="button" className={btnGhost} onClick={() => setCalib(null)}>Cancel</button>
              </div>
              <p className="mt-2 text-xs text-ink-soft">The scale applies to this page for everyone.</p>
            </div>
          )}
          {(p.pinnable || pins.length > 0) && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold">Issues on page {page} ({pagePins.length})</h3>
              {pagePins.length === 0 && <p className="text-sm text-ink-soft">{p.pinnable ? "None pinned. Use Pin issue and click the sheet." : "None pinned."}</p>}
              <ul className="space-y-1" data-testid="pin-list">
                {pagePins.map((pin) => (
                  <li key={pin.issueId} className="flex items-center gap-2 text-sm" data-testid="pin-item">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: pin.color, opacity: pinStyle(pin).opacity }} />
                    <a href={`${issuesBase}/${pin.issueId}`} className="min-w-0 truncate text-brand hover:underline">#{pin.number} {pin.title}</a>
                    {pin.statusName && <span className="ml-auto shrink-0 text-xs text-ink-soft">{pin.statusName}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <h3 className="mb-2 text-sm font-semibold">Markups on page {page} ({pageMarkups.length})</h3>
          {pageMarkups.length === 0 && <p className="text-sm text-ink-soft">None yet. Pick a tool above and draw on the sheet.</p>}
          <ul className="divide-y divide-line" data-testid="markup-list">
            {pageMarkups.map((m) => {
              const mine = m.authorId === p.me;
              const measure = m.type === "LENGTH" || m.type === "AREA";
              return (
                <li key={m.id} className="py-2 text-sm" data-testid="markup-item">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: m.color }} />
                    <span className="font-medium">{TYPE_LABEL[m.type] ?? m.type}</span>
                    <span className={`${badge} ${m.status === "PUBLISHED" ? "bg-emerald-100 text-emerald-800" : "bg-muted text-ink-soft"}`}>
                      {m.status === "PUBLISHED" ? "Published" : "Private"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {m.authorName}
                    {m.text ? ` · “${m.text.length > 60 ? m.text.slice(0, 60) + "…" : m.text}”` : ""}
                    {measure ? ` · ${measureLabel(m.type as "LENGTH" | "AREA", m.points, scale)}` : ""}
                  </p>
                  <div className="mt-1 flex gap-2">
                    {mine && (m.status === "PUBLISHED" || p.canPublish) && (
                      <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => togglePublish(m)}>
                        {m.status === "PUBLISHED" ? "Unpublish" : "Publish"}
                      </button>
                    )}
                    {(mine || p.canManage) && (
                      <button type="button" className={`${btnDanger} px-0 py-0 text-xs`} onClick={() => remove(m)}>Delete</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-ink-soft">
            Private markups are only visible to you. Published markups are visible to everyone who can open this file{p.exportHref ? " and are included in Export PDF" : ""}.
          </p>
        </aside>
      </div>
    </div>
  );
}
