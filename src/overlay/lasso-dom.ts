// Runs the lasso heuristic (lasso.ts) against the live page.
import { MAX_SELECTED_ELEMENTS } from '../shared/constants.js';
import { elementAt, isOverlayHost } from './capture.js';
import { viewportRect } from './geometry.js';
import { centre, chooseInLasso, type LassoNode, type Point, polygonBounds } from './lasso.js';

/** Subtrees that never hold anything a person would circle. */
const SKIPPED_TAGS = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript', 'head', 'title', 'br', 'wbr']);
/** Replaced or control elements: a unit on their own, whatever their styles. */
const BOX_TAGS = new Set(['img', 'picture', 'video', 'canvas', 'svg', 'iframe', 'button', 'input', 'select', 'textarea', 'hr']);

function isTransparent(color: string): boolean {
  // Computed colours are rgb()/rgba(); only a zero alpha is transparent (rgb(0, 0, 0) is black).
  return color === 'transparent' || /^rgba\((?:[^,]+,){3}\s*0(?:\.0+)?\)$/.test(color) || /\/\s*0(?:\.0+)?\)$/.test(color);
}

function hasBoundary(style: CSSStyleDeclaration): boolean {
  if (!isTransparent(style.backgroundColor) || style.backgroundImage !== 'none') return true;
  if (style.boxShadow !== 'none') return true;
  return (['Top', 'Right', 'Bottom', 'Left'] as const).some(
    (side) => parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== 'none' && !isTransparent(style[`border${side}Color`]),
  );
}

/** Screen-reader-only content (the usual .sr-only recipe): in the layout, but nobody sees it. */
function isVisuallyHidden(rect: DOMRect, style: CSSStyleDeclaration): boolean {
  if (rect.width <= 1 && rect.height <= 1) return true;
  return style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)';
}

function domTree(doc: Document): LassoNode<Element> {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (el: Element) => {
    let style = styles.get(el);
    if (!style) styles.set(el, (style = getComputedStyle(el)));
    return style;
  };
  return {
    children: (el) => {
      if (SKIPPED_TAGS.has(el.localName) || isOverlayHost(el) || el.localName === 'svg') return [];
      if (styleOf(el).display === 'none') return [];
      return Array.from(el.children);
    },
    rect: viewportRect,
    selectable: (el) => {
      if (el === doc.documentElement || el === doc.body || isOverlayHost(el) || SKIPPED_TAGS.has(el.localName)) return false;
      const style = styleOf(el);
      if (style.display === 'none' || style.display === 'contents' || style.visibility !== 'visible' || parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !isVisuallyHidden(rect, style);
    },
    isBox: (el) => BOX_TAGS.has(el.localName) || hasBoundary(styleOf(el)),
    hasOwnText: (el) => Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && /\S/.test(n.textContent ?? '')),
  };
}

/**
 * Elements the lasso means, in document order. `polygon` is in viewport coordinates.
 * A loop drawn inside one big element (part of a long paragraph or an image)
 * encloses nothing whole; then the element under the loop's centre stands in.
 */
export function elementsInLasso(polygon: Point[], doc: Document = document): Element[] {
  if (!doc.body) return [];
  const chosen = chooseInLasso(doc.body, domTree(doc), polygon, MAX_SELECTED_ELEMENTS);
  if (chosen.length) return chosen;
  const { x, y } = centre(polygonBounds(polygon));
  const hit = elementAt(x, y, doc);
  return hit && hit !== doc.body ? [hit] : [];
}
