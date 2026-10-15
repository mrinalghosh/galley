// Element capture: what a comment records about each selected element.
// DOM-only and free of UI state, so it can be tested on its own in a browser.
import { OVERLAY_HOST_TAG, SRC_ATTR } from '../shared/constants.js';
import type { ElementInfo, ElementStyles, Rect } from '../shared/protocol.js';

const MAX_TEXT = 200;

/** Ids that frameworks generate per render (React useId, etc.) won't survive a reload. */
function isStableId(id: string): boolean {
  return /^[A-Za-z][\w-]*$/.test(id) && !/^(?:radix-|headlessui-|mui-|react-)/.test(id);
}

function isUnique(root: ParentNode, selector: string, el: Element): boolean {
  try {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === el;
  } catch {
    return false;
  }
}

function attrSelector(name: string, value: string): string {
  return `[${name}="${CSS.escape(value)}"]`;
}

/** A selector that uniquely identifies `el` on its own, if one exists. */
function anchorSelector(el: Element, doc: Document): string | undefined {
  if (el.id && isStableId(el.id)) {
    const selector = `#${CSS.escape(el.id)}`;
    if (isUnique(doc, selector, el)) return selector;
  }
  const testId = el.getAttribute('data-testid');
  if (testId) {
    const selector = attrSelector('data-testid', testId);
    if (isUnique(doc, selector, el)) return selector;
  }
  return undefined;
}

function pathSegment(el: Element): string {
  const tag = el.localName;
  const parent = el.parentElement;
  if (!parent) return tag;
  const sameTag = Array.from(parent.children).filter((child) => child.localName === tag);
  if (sameTag.length === 1) return CSS.escape(tag);
  return `${CSS.escape(tag)}:nth-of-type(${sameTag.indexOf(el) + 1})`;
}

/**
 * Stable selector: id, then data-testid, then an nth-of-type path that stops at
 * the nearest ancestor with an id or test id. Always verified unique.
 */
export function selectorFor(el: Element): string {
  const doc = el.ownerDocument;
  const own = anchorSelector(el, doc);
  if (own) return own;

  const segments: string[] = [];
  let current: Element | null = el;
  while (current && current !== doc.documentElement) {
    if (current !== el) {
      const anchor = anchorSelector(current, doc);
      if (anchor) {
        segments.unshift(anchor);
        break;
      }
    }
    segments.unshift(pathSegment(current));
    if (current === doc.body) break;
    current = current.parentElement;
  }
  const selector = segments.join(' > ');
  if (isUnique(doc, selector, el)) return selector;
  // An anchored path can collide if the anchor sits inside a repeated block; fall back to the full path.
  return fullPath(el);
}

function fullPath(el: Element): string {
  const segments: string[] = [];
  for (let current: Element | null = el; current; current = current.parentElement) segments.unshift(pathSegment(current));
  return segments.join(' > ');
}

/** Rendered text with whitespace collapsed, first 200 characters. */
export function visibleText(el: Element): string {
  const raw = el instanceof HTMLElement ? el.innerText : (el.textContent ?? '');
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

/** "file:line:col" from the nearest ancestor-or-self tagged by the Vite plugin. */
export function sourceOf(el: Element): string | undefined {
  return el.closest(`[${SRC_ATTR}]`)?.getAttribute(SRC_ATTR) ?? undefined;
}

export function pageRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  const win = el.ownerDocument.defaultView ?? window;
  return { x: round(r.left + win.scrollX), y: round(r.top + win.scrollY), w: round(r.width), h: round(r.height) };
}

export function stylesOf(el: Element): ElementStyles {
  const s = getComputedStyle(el);
  return {
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    color: s.color,
    backgroundColor: s.backgroundColor,
    padding: s.padding,
    margin: s.margin,
    gap: s.gap,
    borderRadius: s.borderRadius,
  };
}

export function captureElement(el: Element): ElementInfo {
  const info: ElementInfo = {
    selector: selectorFor(el),
    tag: el.localName,
    classes: Array.from(el.classList),
    text: visibleText(el),
    rect: pageRect(el),
    styles: stylesOf(el),
  };
  const src = sourceOf(el);
  if (src) info.src = src;
  return info;
}

/** Union of rects, in the same coordinate space. */
export function boundingRect(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function commonAncestor(elements: Element[]): Element | undefined {
  const [first, ...rest] = elements;
  if (!first) return undefined;
  for (let candidate: Element | null = first.parentElement; candidate; candidate = candidate.parentElement) {
    if (rest.every((el) => candidate!.contains(el))) return candidate;
  }
  return undefined;
}

/** True for our own host element (the picker must never select it). */
export function isOverlayHost(el: Element | null): boolean {
  return !!el && el.localName === OVERLAY_HOST_TAG;
}

/** Topmost page element at a viewport point, skipping the overlay's host. */
export function elementAt(x: number, y: number, doc: Document = document): Element | undefined {
  return doc.elementsFromPoint(x, y).find((el) => !isOverlayHost(el) && el !== doc.documentElement);
}

/**
 * Finds a comment's element again after re-renders: its selector first, then its
 * source attribute when that is unique and matches the tag. Returns undefined when it is gone.
 */
export function resolveElement(info: Pick<ElementInfo, 'selector' | 'src' | 'tag'>, doc: Document = document): Element | undefined {
  try {
    const found = doc.querySelector(info.selector);
    if (found && !isOverlayHost(found)) return found;
  } catch {
    // Stored selector no longer parses (shouldn't happen); try the source hint.
  }
  if (!info.src) return undefined;
  // src may belong to an ancestor; only trust it when it lands on the same kind of element.
  const bySrc = doc.querySelectorAll(attrSelector(SRC_ATTR, info.src));
  const only = bySrc.length === 1 ? bySrc[0] : undefined;
  return only?.localName === info.tag ? only : undefined;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
