import { describe, expect, it } from 'vitest';
import { cropFor, MAX_CROP_EDGE, MAX_OUTPUT_EDGE, MAX_OUTPUT_PIXELS, scaleFor } from './screenshot.js';

describe('cropFor', () => {
  const page = { w: 1280, h: 3000 };

  it('pads the selection by 24px', () => {
    expect(cropFor({ x: 100, y: 200, w: 300, h: 100 }, page)).toEqual({ x: 76, y: 176, w: 348, h: 148 });
  });

  it('clamps to the page and rounds outwards', () => {
    expect(cropFor({ x: 10.4, y: 5, w: 1265, h: 20.2 }, page)).toEqual({ x: 0, y: 0, w: 1280, h: 50 });
    expect(cropFor({ x: 1200, y: 2990, w: 200, h: 50 }, page)).toEqual({ x: 1176, y: 2966, w: 104, h: 34 });
  });

  it('keeps the top of a very tall selection', () => {
    const crop = cropFor({ x: 0, y: 100, w: 800, h: 20_000 }, { w: 1280, h: 30_000 })!;
    expect(crop.y).toBe(76);
    expect(crop.h).toBe(MAX_CROP_EDGE);
  });

  it('is undefined when the selection is off the page', () => {
    expect(cropFor({ x: 5000, y: 0, w: 10, h: 10 }, page)).toBeUndefined();
  });
});

describe('scaleFor', () => {
  it('uses devicePixelRatio for ordinary crops', () => {
    expect(scaleFor({ x: 0, y: 0, w: 800, h: 400 }, 2)).toBe(2);
    expect(scaleFor({ x: 0, y: 0, w: 800, h: 400 }, 0)).toBe(1);
  });

  it('lowers the scale for very large crops', () => {
    const edge = { x: 0, y: 0, w: 3000, h: 300 };
    expect(scaleFor(edge, 2) * 3000).toBeLessThanOrEqual(MAX_OUTPUT_EDGE);
    const area = { x: 0, y: 0, w: 2500, h: 2500 };
    const s = scaleFor(area, 2);
    expect(2500 * s * 2500 * s).toBeLessThanOrEqual(MAX_OUTPUT_PIXELS + 1);
  });
});
