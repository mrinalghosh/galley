// Lasso geometry and the element-choice heuristic. Pure: no DOM access, so it
// can be unit-tested on synthetic trees. lasso-dom.ts adapts it to the page.
import type { Rect } from '../shared/protocol.js';

export interface Point {
  x: number;
  y: number;
}

/** Even-odd ray cast. Also handles self-crossing freehand loops consistently. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const crosses = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function polygonBounds(polygon: Point[]): Rect {
  if (polygon.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const SAMPLES = 8;

/**
 * Share of `rect` inside the polygon, 0..1, estimated on an 8×8 grid of cell
 * centres. Sampling (rather than exact clipping) uses the same even-odd rule as
 * the centre test, so a self-crossing loop is judged the same way by both.
 */
export function containment(rect: Rect, polygon: Point[], bounds = polygonBounds(polygon)): number {
  if (rect.w <= 0 || rect.h <= 0 || !intersects(rect, bounds)) return 0;
  let inside = 0;
  for (let i = 0; i < SAMPLES; i++) {
    for (let j = 0; j < SAMPLES; j++) {
      const point = { x: rect.x + ((i + 0.5) * rect.w) / SAMPLES, y: rect.y + ((j + 0.5) * rect.h) / SAMPLES };
      if (pointInPolygon(point, polygon)) inside++;
    }
  }
  return inside / (SAMPLES * SAMPLES);
}

export function centre(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Drops points closer than `minDistance` to the last kept one (pointer jitter). */
export function addPoint(points: Point[], point: Point, minDistance = 3): Point[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < minDistance) return points;
  return [...points, point];
}

/** Closed SVG path through the points, smoothed with quadratic curves between midpoints. */
export function smoothPath(points: Point[]): string {
  if (points.length < 3) return points.length ? `M${points.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join(' L')}` : '';
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(points[points.length - 1]!, points[0]!);
  let d = `M${fmt(start.x)} ${fmt(start.y)}`;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const m = mid(p, points[(i + 1) % points.length]!);
    d += ` Q${fmt(p.x)} ${fmt(p.y)} ${fmt(m.x)} ${fmt(m.y)}`;
  }
  return `${d} Z`;
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** What the heuristic needs to know about a node. The DOM adapter reads it from layout and computed style. */
export interface LassoNode<T> {
  children(node: T): T[];
  /** Viewport rect, same space as the polygon. */
  rect(node: T): Rect;
  /** False for hidden, zero-size, or never-selectable nodes (html, body, the overlay host). */
  selectable(node: T): boolean;
  /** Draws its own boundary: background, border, shadow, or replaced content (img, button, input…). */
  isBox(node: T): boolean;
  /** Has non-whitespace text of its own, not just in children. */
  hasOwnText(node: T): boolean;
}

/** An element counts as "inside" when this much of its box is within the lasso. */
export const MIN_CONTAINMENT = 0.75;

/**
 * Chooses the elements a lasso means. Taken literally ("everything whose centre
 * is inside, minus descendants of those") it returns the outermost wrapper that
 * happens to fit: circling three cards would yield only their row. Instead:
 *
 * 1. Qualify: selectable, centre inside the polygon, and at least 75% of the
 *    box inside. Loose wrappers that stick out of the loop drop out here.
 * 2. Walk down from the outermost qualifying elements. Keep an element as a
 *    unit when any of these hold, otherwise replace it by its qualifying
 *    descendants (nearest ones, skipping non-qualifying layers in between):
 *    - fewer than two qualifying descendants (a leaf or a single-child chain);
 *    - it has text of its own (a paragraph with links is one thing, not its links);
 *    - it is a visual box (card, button, image) and none of its qualifying
 *      descendants is: its contents are plain text and headings.
 *    So a row of cards (a plain layout wrapper) splits into cards, a card
 *    stays a card, and a panel full of cards splits into the cards.
 * 3. If splitting would exceed `max`, keep the element whole instead, and cap
 *    the final list at `max` in document order.
 *
 * Nothing chosen is an ancestor of anything else chosen.
 */
export function chooseInLasso<T>(root: T, tree: LassoNode<T>, polygon: Point[], max: number): T[] {
  if (polygon.length < 3) return [];
  const bounds = polygonBounds(polygon);
  const memo = new Map<T, boolean>();
  const test = (node: T): boolean => {
    if (!tree.selectable(node)) return false;
    const rect = tree.rect(node);
    return intersects(rect, bounds) && pointInPolygon(centre(rect), polygon) && containment(rect, polygon, bounds) >= MIN_CONTAINMENT;
  };
  const qualifies = (node: T): boolean => {
    let result = memo.get(node);
    if (result === undefined) memo.set(node, (result = test(node)));
    return result;
  };

  const nearestQualifying = (node: T): T[] =>
    tree.children(node).flatMap((child) => (qualifies(child) ? [child] : nearestQualifying(child)));

  const choose = (node: T): T[] => {
    const inner = nearestQualifying(node);
    if (inner.length < 2 || tree.hasOwnText(node)) return [node];
    if (tree.isBox(node) && !inner.some((n) => tree.isBox(n))) return [node];
    const split = inner.flatMap(choose);
    return split.length > max ? [node] : split;
  };

  return nearestQualifying(root).flatMap(choose).slice(0, max);
}
