// Screenshot of a selection: the page rendered with modern-screenshot (DOM ->
// SVG foreignObject -> canvas) at devicePixelRatio, cropped to the selection
// plus a margin. The overlay host is filtered out, so highlights, the lasso and
// the composer never appear in it.
import { createContext, destroyContext, domToPng } from 'modern-screenshot';
import type { Rect } from '../shared/protocol.js';
import { isOverlayHost, pageRect } from './capture.js';

export const SHOT_PADDING = 24;
/** Longest side of the crop in CSS pixels; a taller selection keeps its top part. */
export const MAX_CROP_EDGE = 4000;
/** Output limits in device pixels, to keep capture time and upload size sane. */
export const MAX_OUTPUT_EDGE = 4096;
export const MAX_OUTPUT_PIXELS = 12_000_000;
/** Resource loads (images, fonts) give up after this long; the shot uses what it has. */
const LOAD_TIMEOUT_MS = 3000;

/** The selection box plus padding, clamped to the page and to MAX_CROP_EDGE. Undefined when nothing is left. */
export function cropFor(selection: Rect, page: { w: number; h: number }, padding = SHOT_PADDING): Rect | undefined {
  const x = Math.max(0, Math.floor(selection.x - padding));
  const y = Math.max(0, Math.floor(selection.y - padding));
  const right = Math.min(page.w, Math.ceil(selection.x + selection.w + padding), x + MAX_CROP_EDGE);
  const bottom = Math.min(page.h, Math.ceil(selection.y + selection.h + padding), y + MAX_CROP_EDGE);
  if (right - x < 1 || bottom - y < 1) return undefined;
  return { x, y, w: right - x, h: bottom - y };
}

/** devicePixelRatio, lowered when the output would pass the edge or pixel limits. */
export function scaleFor(crop: Rect, dpr: number): number {
  const byEdge = MAX_OUTPUT_EDGE / Math.max(crop.w, crop.h);
  const byArea = Math.sqrt(MAX_OUTPUT_PIXELS / (crop.w * crop.h));
  return Math.max(0.1, Math.min(dpr || 1, byEdge, byArea));
}

function contains(outer: Rect, inner: Rect): boolean {
  return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;
}

/**
 * Smallest element around `start` whose box covers the crop. Cloning a subtree
 * instead of the whole document is most of the saving on large pages.
 */
function renderRoot(start: Element | undefined, crop: Rect): Element {
  const doc = document.documentElement;
  for (let el = start; el && el !== doc; el = el.parentElement ?? undefined) {
    if (contains(pageRect(el), crop)) return el;
  }
  return doc;
}

function isTransparent(color: string): boolean {
  return color === 'transparent' || /^rgba\((?:[^,]+,){3}\s*0(?:\.0+)?\)$/.test(color);
}

/** What shows behind `el`: its own background or the nearest ancestor's, as the browser's canvas would. */
function backdrop(el: Element): string {
  for (let current: Element | null = el; current; current = current.parentElement) {
    const color = getComputedStyle(current).backgroundColor;
    if (!isTransparent(color)) return color;
  }
  const body = document.body && getComputedStyle(document.body).backgroundColor;
  return body && !isTransparent(body) ? body : '#ffffff';
}

function pageSize(): { w: number; h: number } {
  const root = document.documentElement;
  return { w: Math.max(root.scrollWidth, root.clientWidth), h: Math.max(root.scrollHeight, root.clientHeight) };
}

/**
 * PNG data URL of `selection` (page coordinates) plus SHOT_PADDING. `near` is
 * any element inside the selection; it picks the subtree to render.
 *
 * Only the crop is rasterised: after cloning, the SVG canvas is shrunk to the
 * crop and the foreignObject shifted by the crop's offset inside the root.
 */
export async function captureSelection(selection: Rect, near?: Element): Promise<string> {
  const crop = cropFor(selection, pageSize());
  if (!crop) throw new Error('selection is outside the page');
  const root = renderRoot(near, crop);
  const origin = pageRect(root);
  const full = { w: Math.max(origin.w, root.scrollWidth), h: Math.max(origin.h, root.scrollHeight) };

  const context = await createContext(root, {
    scale: scaleFor(crop, window.devicePixelRatio),
    backgroundColor: backdrop(root),
    timeout: LOAD_TIMEOUT_MS,
    filter: (node) => !(node instanceof Element && isOverlayHost(node)),
    // Runs after the root clone got its real size, before the SVG is built.
    onCloneNode: () => {
      context.width = crop.w;
      context.height = crop.h;
    },
    onCreateForeignObjectSvg: (svg) => {
      const object = svg.querySelector('foreignObject');
      if (!object) return;
      object.setAttribute('x', String(origin.x - crop.x));
      object.setAttribute('y', String(origin.y - crop.y));
      object.setAttribute('width', String(full.w));
      object.setAttribute('height', String(full.h));
    },
  });
  try {
    return await domToPng(context);
  } finally {
    destroyContext(context);
  }
}
