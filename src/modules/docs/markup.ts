// Pure markup and measurement logic shared by the viewer (browser), the server
// actions and the PDF export. Coordinates are page units: PDF points at 100%
// zoom (or image pixels), origin top-left, y downwards.
import { z } from "zod";

export const MARKUP_TYPES = ["PEN", "RECT", "CLOUD", "ARROW", "TEXT", "LENGTH", "AREA"] as const;
export type MarkupType = (typeof MARKUP_TYPES)[number];
export type Pt = [number, number];

export const MARKUP_COLORS = ["#d32f2f", "#1565c0", "#2e7d32", "#ef6c00", "#6a1b9a", "#111111"] as const;
export const MAX_POINTS = 2000;
export const MAX_TEXT = 500;

export const UNITS = ["m", "mm", "cm", "ft", "in"] as const;
export type Unit = (typeof UNITS)[number];

const finite = z.number().finite().min(-1e6).max(1e6);
export const markupInput = z
  .object({
    page: z.number().int().min(1).max(10_000),
    type: z.enum(MARKUP_TYPES),
    points: z.array(z.tuple([finite, finite])).min(1).max(MAX_POINTS),
    color: z.enum(MARKUP_COLORS),
    text: z.string().trim().max(MAX_TEXT).optional(),
  })
  .superRefine((m, ctx) => {
    const min: Record<MarkupType, number> = { PEN: 2, RECT: 2, CLOUD: 2, ARROW: 2, TEXT: 1, LENGTH: 2, AREA: 3 };
    if (m.points.length < min[m.type]) ctx.addIssue({ code: "custom", message: `${m.type} needs at least ${min[m.type]} points` });
    if (m.type === "TEXT" && !m.text) ctx.addIssue({ code: "custom", message: "Text markups need text" });
  });
export type MarkupInput = z.infer<typeof markupInput>;

export const calibrationInput = z.object({
  page: z.number().int().min(1).max(10_000),
  a: z.tuple([finite, finite]),
  b: z.tuple([finite, finite]),
  distance: z.number().positive().max(1e6),
  unit: z.enum(UNITS),
});

// ---------- geometry ----------

export const distance = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function polylineLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

/** Area of a simple polygon (shoelace formula); closing edge implied. */
export function polygonArea(points: Pt[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Real units per page unit from a reference line of known length. Null for a zero-length line. */
export function calibrate(a: Pt, b: Pt, realDistance: number): number | null {
  const d = distance(a, b);
  return d < 1e-6 || !(realDistance > 0) ? null : realDistance / d;
}

const round = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(3));

/** "12.35 m" for a LENGTH, "48.20 m²" for an AREA; page units when the sheet isn't calibrated. */
export function measureLabel(type: "LENGTH" | "AREA", points: Pt[], scale?: { unitsPerPoint: number; unit: string } | null): string {
  if (type === "LENGTH") {
    const len = polylineLength(points);
    return scale ? `${round(len * scale.unitsPerPoint)} ${scale.unit}` : `${round(len)} pt (not calibrated)`;
  }
  const area = polygonArea(points);
  return scale ? `${round(area * scale.unitsPerPoint ** 2)} ${scale.unit}²` : `${round(area)} pt² (not calibrated)`;
}

/** Drops points closer than `minGap` to the last kept point; always keeps the last one. */
export function simplify(points: Pt[], minGap = 1.5): Pt[] {
  if (points.length <= 2) return points;
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) if (distance(out[out.length - 1], points[i]) >= minGap) out.push(points[i]);
  out.push(points[points.length - 1]);
  return out.slice(0, MAX_POINTS);
}

export function rectOf(a: Pt, b: Pt) {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

const f = (n: number) => +n.toFixed(2);

/** Revision cloud around a rectangle: a row of outward arcs along each edge. */
export function cloudPath(a: Pt, b: Pt, bump = 12): string {
  const { x, y, w, h } = rectOf(a, b);
  const corners: Pt[] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  let d = `M ${f(x)} ${f(y)}`;
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % 4];
    const len = distance(p, q);
    const n = Math.max(1, Math.round(len / bump));
    const r = len / n / 2;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      d += ` A ${f(r)} ${f(r)} 0 0 1 ${f(p[0] + (q[0] - p[0]) * t)} ${f(p[1] + (q[1] - p[1]) * t)}`;
    }
  }
  return d + " Z";
}

/** The two barb end points of an arrow head at `to`. */
export function arrowHead(from: Pt, to: Pt, size = 12): [Pt, Pt] {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const spread = Math.PI / 7;
  return [
    [to[0] - size * Math.cos(ang - spread), to[1] - size * Math.sin(ang - spread)],
    [to[0] - size * Math.cos(ang + spread), to[1] - size * Math.sin(ang + spread)],
  ];
}

/** SVG path for a markup (all types except TEXT), used both on screen and in the PDF export. */
export function markupPath(type: MarkupType, points: Pt[]): string {
  const line = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"} ${f(p[0])} ${f(p[1])}`).join(" ");
  const a = points[0];
  const b = points[points.length - 1];
  switch (type) {
    case "PEN":
    case "LENGTH":
      return line(points);
    case "AREA":
      return line(points) + " Z";
    case "RECT": {
      const r = rectOf(a, b);
      return `M ${f(r.x)} ${f(r.y)} H ${f(r.x + r.w)} V ${f(r.y + r.h)} H ${f(r.x)} Z`;
    }
    case "CLOUD":
      return cloudPath(a, b);
    case "ARROW": {
      const [l, r] = arrowHead(a, b);
      return `${line([a, b])} M ${f(l[0])} ${f(l[1])} L ${f(b[0])} ${f(b[1])} L ${f(r[0])} ${f(r[1])}`;
    }
    case "TEXT":
      return "";
  }
}

/** Where a measurement label sits: the midpoint of a line, or the centroid of the vertices. */
export function labelAnchor(type: "LENGTH" | "AREA", points: Pt[]): Pt {
  if (type === "LENGTH" && points.length >= 2) {
    const mid = Math.floor((points.length - 1) / 2);
    const p = points[mid];
    const q = points[mid + 1] ?? p;
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  }
  const sx = points.reduce((s, p) => s + p[0], 0);
  const sy = points.reduce((s, p) => s + p[1], 0);
  return [sx / points.length, sy / points.length];
}

/** Which markups a member sees: everything published, plus their own private ones. */
export const visibleTo = <T extends { status: string; authorId: string | null }>(markups: T[], userId: string) =>
  markups.filter((m) => m.status === "PUBLISHED" || m.authorId === userId);

export const isViewable = (contentType: string, name: string) =>
  contentType === "application/pdf" || /\.pdf$/i.test(name) || isImage(contentType, name);
export const isImage = (contentType: string, name: string) =>
  /^image\/(png|jpe?g|webp|gif)$/.test(contentType) || /\.(png|jpe?g|webp|gif)$/i.test(name);
