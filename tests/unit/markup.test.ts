import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { exportWithMarkups } from "@/modules/docs/export";
import {
  arrowHead,
  calibrate,
  cloudPath,
  distance,
  isImage,
  isViewable,
  labelAnchor,
  markupInput,
  markupPath,
  measureLabel,
  polygonArea,
  polylineLength,
  simplify,
  visibleTo,
  type Pt,
} from "@/modules/docs/markup";

describe("geometry", () => {
  it("measures distances, polylines and polygon areas", () => {
    expect(distance([0, 0], [3, 4])).toBe(5);
    expect(polylineLength([[0, 0], [3, 4], [3, 10]])).toBe(11);
    expect(polygonArea([[0, 0], [10, 0], [10, 5], [0, 5]])).toBe(50);
    expect(polygonArea([[0, 0], [0, 5], [10, 5], [10, 0]])).toBe(50); // orientation doesn't matter
    expect(polygonArea([[0, 0], [4, 0], [0, 3]])).toBe(6);
  });
  it("calibrates real units per page unit, rejecting degenerate lines", () => {
    expect(calibrate([0, 0], [100, 0], 5)).toBeCloseTo(0.05);
    expect(calibrate([1, 1], [1, 1], 5)).toBeNull();
    expect(calibrate([0, 0], [10, 0], 0)).toBeNull();
  });
  it("labels measurements with and without a scale", () => {
    const scale = { unitsPerPoint: 0.05, unit: "m" };
    expect(measureLabel("LENGTH", [[0, 0], [100, 0], [100, 50]], scale)).toBe("7.500 m");
    expect(measureLabel("AREA", [[0, 0], [200, 0], [200, 100], [0, 100]], scale)).toBe("50.00 m²");
    expect(measureLabel("LENGTH", [[0, 0], [30, 40]])).toBe("50.00 pt (not calibrated)");
  });
  it("anchors labels at the middle of a line or the centroid of an area", () => {
    expect(labelAnchor("LENGTH", [[0, 0], [10, 0]])).toEqual([5, 0]);
    expect(labelAnchor("AREA", [[0, 0], [10, 0], [10, 10], [0, 10]])).toEqual([5, 5]);
  });
  it("simplifies pen strokes but keeps both ends", () => {
    const pts: Pt[] = Array.from({ length: 100 }, (_, i) => [i * 0.1, 0]);
    const s = simplify(pts);
    expect(s[0]).toEqual([0, 0]);
    expect(s[s.length - 1]).toEqual(pts[99]);
    expect(s.length).toBeLessThan(10);
  });
  it("points the arrow head barbs back along the shaft", () => {
    const [l, r] = arrowHead([0, 0], [100, 0], 10);
    expect(l[0]).toBeLessThan(100);
    expect(r[0]).toBeLessThan(100);
    expect(Math.sign(l[1])).toBe(-Math.sign(r[1]));
  });
});

describe("markupPath", () => {
  it("builds SVG paths for each shape", () => {
    expect(markupPath("RECT", [[30, 40], [10, 20]])).toBe("M 10 20 H 30 V 40 H 10 Z");
    expect(markupPath("PEN", [[0, 0], [5, 5]])).toBe("M 0 0 L 5 5");
    expect(markupPath("AREA", [[0, 0], [5, 0], [5, 5]])).toBe("M 0 0 L 5 0 L 5 5 Z");
    expect(markupPath("ARROW", [[0, 0], [100, 0]])).toMatch(/^M 0 0 L 100 0 M .* L 100 0 L /);
    expect(markupPath("TEXT", [[0, 0]])).toBe("");
  });
  it("draws a cloud as arcs around the box, closed", () => {
    const d = cloudPath([0, 0], [120, 60], 12);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d.match(/ A /g)!.length).toBe(10 + 5 + 10 + 5);
  });
});

describe("markupInput validation", () => {
  const ok = { page: 1, type: "RECT", points: [[0, 0], [10, 10]], color: "#d32f2f" };
  it("accepts a valid markup", () => expect(markupInput.safeParse(ok).success).toBe(true));
  it.each([
    ["an unknown colour", { ...ok, color: "#123456" }],
    ["too few area points", { ...ok, type: "AREA" }],
    ["text without text", { ...ok, type: "TEXT", points: [[1, 1]] }],
    ["page 0", { ...ok, page: 0 }],
    ["non-finite numbers", { ...ok, points: [[0, 0], [Infinity, 1]] }],
    ["too many points", { ...ok, type: "PEN", points: Array.from({ length: 2001 }, () => [1, 1]) }],
  ])("rejects %s", (_, input) => expect(markupInput.safeParse(input).success).toBe(false));
});

describe("visibility and file types", () => {
  it("shows published markups to everyone and private ones only to their author", () => {
    const ms = [
      { id: "a", status: "PUBLISHED", authorId: "u2" },
      { id: "b", status: "PRIVATE", authorId: "u1" },
      { id: "c", status: "PRIVATE", authorId: "u2" },
    ];
    expect(visibleTo(ms, "u1").map((m) => m.id)).toEqual(["a", "b"]);
  });
  it("knows which files open in the viewer", () => {
    expect(isViewable("application/pdf", "x.pdf")).toBe(true);
    expect(isViewable("application/octet-stream", "Plan.PDF")).toBe(true);
    expect(isViewable("image/jpeg", "site.jpg")).toBe(true);
    expect(isImage("image/png", "a.png")).toBe(true);
    expect(isViewable("application/vnd.ms-excel", "a.xls")).toBe(false);
  });
});

describe("exportWithMarkups", () => {
  it("draws published markups into the right pages of a PDF", async () => {
    const src = await PDFDocument.create();
    src.addPage([600, 400]);
    src.addPage([600, 400]);
    const before = await src.save();
    const out = await exportWithMarkups(
      before,
      "application/pdf",
      "plan.pdf",
      [
        { page: 2, type: "RECT", points: [[10, 10], [100, 80]], color: "#d32f2f", text: null },
        { page: 2, type: "TEXT", points: [[50, 50]], color: "#1565c0", text: "Check slab ≈ level" },
        { page: 2, type: "LENGTH", points: [[0, 0], [100, 0]], color: "#111111", text: null },
      ],
      [{ page: 2, unitsPerPoint: 0.05, unit: "m" }],
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    const content = (n: number) => {
      const c = doc.getPage(n).node.Contents();
      return c ? c.toString().length : 0;
    };
    expect(content(1)).toBeGreaterThan(content(0)); // page 2 gained drawing operators
    expect(out.byteLength).toBeGreaterThan(before.byteLength);
  });
  it("wraps a PNG in a one-page PDF the size of the image", async () => {
    // 1×1 transparent PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    const out = await exportWithMarkups(new Uint8Array(png), "image/png", "a.png", [], []);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getSize()).toEqual({ width: 1, height: 1 });
  });
  it("refuses image types it can't embed", async () => {
    await expect(exportWithMarkups(new Uint8Array([1, 2, 3]), "image/webp", "a.webp", [], [])).rejects.toThrow(/PNG and JPEG/);
  });
});
