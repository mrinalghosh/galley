// Coordinate helpers. Stored rects are page coordinates; the overlay draws in
// viewport coordinates (its layers are position: fixed).
import type { Comment, Rect } from '../shared/protocol.js';
import { resolveElement } from './capture.js';

export function viewportRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export function pageToViewport(rect: Rect): Rect {
  return { ...rect, x: rect.x - window.scrollX, y: rect.y - window.scrollY };
}

export interface PinAnchor {
  /** Viewport rect the pin belongs to. */
  rect: Rect;
  /** 'element' when the selector still resolves, 'stored' when using saved page coordinates. */
  source: 'element' | 'stored';
}

/** Where a comment's pin goes right now. Re-resolved on every layout change. */
export function anchorFor(comment: Pick<Comment, 'elements' | 'region'>): PinAnchor {
  const first = comment.elements[0];
  const el = first ? resolveElement(first) : undefined;
  if (el && el.isConnected) {
    const rect = viewportRect(el);
    // display: contents or hidden elements have no box; the stored spot is more useful.
    if (rect.w > 0 || rect.h > 0) return { rect, source: 'element' };
  }
  return { rect: pageToViewport(first?.rect ?? comment.region), source: 'stored' };
}

/** Places a w×h box beside `anchor`: right, then left, then below; kept on screen. */
export function placeBeside(anchor: Rect, w: number, h: number, gap = 12): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x: number;
  let y = anchor.y;
  if (anchor.x + anchor.w + gap + w <= vw) x = anchor.x + anchor.w + gap;
  else if (anchor.x - gap - w >= 0) x = anchor.x - gap - w;
  else {
    x = anchor.x;
    y = anchor.y + anchor.h + gap;
    if (y + h > vh) y = anchor.y - gap - h;
  }
  return { x: clamp(x, 8, vw - w - 8), y: clamp(y, 8, vh - h - 8) };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/** Current page path, the key comments are stored under. */
export function currentUrl(): string {
  return location.pathname + location.search;
}
