import { describe, expect, it } from "vitest";
import { scaleBox } from "../../../components/PdfPage";
import type { BBox } from "../model";

/**
 * The overlay only lands on the right glyphs if the box captured during extraction is
 * scaled by exactly the factor the canvas was rendered at. These cases pin that down.
 */
describe("bbox -> overlay transform", () => {
  const box: BBox = [72, 163, 510, 211];

  it("is the identity at scale 1", () => {
    expect(scaleBox(box, 1)).toEqual({ left: 72, top: 163, width: 438, height: 48 });
  });

  it("scales position and size together", () => {
    const r = scaleBox(box, 0.5);
    expect(r).toEqual({ left: 36, top: 81.5, width: 219, height: 24 });
  });

  it("matches the scale a 560px-wide render of A4 uses", () => {
    // A4 is 595.28pt wide; the pane renders at most 560px.
    const scale = 560 / 595.28;
    const r = scaleBox(box, scale);
    expect(r.left).toBeCloseTo(72 * scale, 6);
    expect(r.left + r.width).toBeCloseTo(510 * scale, 6);
    expect(r.top + r.height).toBeCloseTo(211 * scale, 6);
  });

  it("keeps a hairline box visible", () => {
    // A zero-height box would otherwise vanish, marking nothing.
    const thin: BBox = [100, 100, 100, 100];
    const r = scaleBox(thin, 1);
    expect(r.width).toBeGreaterThanOrEqual(2);
    expect(r.height).toBeGreaterThanOrEqual(2);
  });

  it("never produces negative dimensions", () => {
    const inverted: BBox = [200, 300, 100, 200];
    const r = scaleBox(inverted, 1);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});
