// Pure geometry and the lasso selection heuristic, on synthetic trees.
import { describe, expect, it } from 'vitest';
import type { Rect } from '../shared/protocol.js';
import { addPoint, chooseInLasso, containment, type LassoNode, type Point, pointInPolygon, polygonBounds, smoothPath } from './lasso.js';

const square = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** A freehand-ish loop: an ellipse through `n` points around a rect. */
function ellipseAround(r: Rect, margin: number, n = 48): Point[] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  // An ellipse through the rect's corners, pushed out by the margin.
  const rx = (r.w / 2 + margin) * Math.SQRT2;
  const ry = (r.h / 2 + margin) * Math.SQRT2;
  return Array.from({ length: n }, (_, i) => ({ x: cx + rx * Math.cos((2 * Math.PI * i) / n), y: cy + ry * Math.sin((2 * Math.PI * i) / n) }));
}

describe('pointInPolygon', () => {
  const concave: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 5, y: 4 },
    { x: 0, y: 10 },
  ];

  it('handles convex and concave shapes', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square(0, 0, 10, 10))).toBe(true);
    expect(pointInPolygon({ x: 11, y: 5 }, square(0, 0, 10, 10))).toBe(false);
    expect(pointInPolygon({ x: 5, y: 2 }, concave)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 8 }, concave)).toBe(false); // in the notch
    expect(pointInPolygon({ x: 1, y: 8 }, concave)).toBe(true);
  });

  it('treats a degenerate polygon as empty', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(pointInPolygon({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 2, y: 2 }])).toBe(false);
  });
});

describe('containment', () => {
  const loop = square(0, 0, 100, 100);

  it('is 1 inside, 0 outside, and proportional across the edge', () => {
    expect(containment({ x: 10, y: 10, w: 20, h: 20 }, loop)).toBe(1);
    expect(containment({ x: 200, y: 10, w: 20, h: 20 }, loop)).toBe(0);
    expect(containment({ x: 50, y: 10, w: 100, h: 20 }, loop)).toBe(0.5);
    expect(containment({ x: 75, y: 75, w: 100, h: 100 }, loop)).toBeCloseTo(0.0625, 2);
  });

  it('is 0 for an empty rect', () => {
    expect(containment({ x: 10, y: 10, w: 0, h: 20 }, loop)).toBe(0);
  });
});

describe('path helpers', () => {
  it('bounds a polygon', () => {
    expect(polygonBounds([{ x: 5, y: 1 }, { x: -2, y: 7 }, { x: 3, y: 4 }])).toEqual({ x: -2, y: 1, w: 7, h: 6 });
  });

  it('drops jitter points', () => {
    const pts = addPoint([{ x: 0, y: 0 }], { x: 1, y: 1 });
    expect(pts).toHaveLength(1);
    expect(addPoint(pts, { x: 5, y: 0 })).toHaveLength(2);
  });

  it('builds a closed, smoothed path', () => {
    const d = smoothPath(square(0, 0, 10, 10));
    expect(d.startsWith('M0 5')).toBe(true);
    expect(d.match(/Q/g)).toHaveLength(4);
    expect(d.endsWith('Z')).toBe(true);
  });
});

// --- Selection over a synthetic tree -----------------------------------------

interface Node {
  name: string;
  rect: Rect;
  children: Node[];
  box?: boolean;
  text?: boolean;
  hidden?: boolean;
}

const tree: LassoNode<Node> = {
  children: (n) => n.children,
  rect: (n) => n.rect,
  selectable: (n) => !n.hidden && n.rect.w > 0 && n.rect.h > 0,
  isBox: (n) => !!n.box,
  hasOwnText: (n) => !!n.text,
};

const node = (name: string, rect: Rect, children: Node[] = [], extra: Partial<Node> = {}): Node => ({ name, rect, children, ...extra });
const names = (nodes: Node[]) => nodes.map((n) => n.name);

/** A card: bordered box with a heading and a paragraph of text. */
function card(name: string, x: number): Node {
  return node(name, { x, y: 300, w: 300, h: 140 }, [
    node(`${name} h3`, { x: x + 20, y: 320, w: 260, h: 24 }, [], { text: true }),
    node(`${name} p`, { x: x + 20, y: 352, w: 260, h: 48 }, [node(`${name} a`, { x: x + 20, y: 352, w: 60, h: 20 }, [], { text: true })], { text: true }),
  ], { box: true });
}

function page(): { body: Node; row: Node; cards: Node[] } {
  const cards = [card('card1', 40), card('card2', 356), card('card3', 672)];
  const row = node('row', { x: 40, y: 300, w: 932, h: 140 }, cards);
  const hero = node('hero', { x: 40, y: 80, w: 932, h: 180 }, [
    node('h1', { x: 40, y: 80, w: 600, h: 60 }, [], { text: true }),
    node('actions', { x: 40, y: 200, w: 300, h: 40 }, [
      node('btn1', { x: 40, y: 200, w: 120, h: 40 }, [], { box: true, text: true }),
      node('btn2', { x: 180, y: 200, w: 120, h: 40 }, [], { box: true, text: true }),
    ]),
  ]);
  const main = node('main', { x: 0, y: 60, w: 1012, h: 900 }, [hero, row, node('hidden', { x: 100, y: 350, w: 50, h: 50 }, [], { hidden: true })]);
  return { body: node('body', { x: 0, y: 0, w: 1012, h: 2000 }, [main]), row, cards };
}

describe('chooseInLasso', () => {
  it('circling three cards selects the three cards, not their row or their contents', () => {
    const { body, row } = page();
    expect(names(chooseInLasso(body, tree, ellipseAround(row.rect, 8), 20))).toEqual(['card1', 'card2', 'card3']);
  });

  it('a tight rectangle around the row gives the same answer', () => {
    const { body, row } = page();
    const r = row.rect;
    expect(names(chooseInLasso(body, tree, square(r.x - 4, r.y - 4, r.w + 8, r.h + 8), 20))).toEqual(['card1', 'card2', 'card3']);
  });

  it('circling one card selects just that card', () => {
    const { body, cards } = page();
    expect(names(chooseInLasso(body, tree, ellipseAround(cards[1]!.rect, 6), 20))).toEqual(['card2']);
  });

  it('circling two of three cards selects those two; the row sticks out, so it never qualifies', () => {
    const { body, cards } = page();
    const r = { x: cards[0]!.rect.x, y: 300, w: cards[1]!.rect.x + 300 - cards[0]!.rect.x, h: 140 };
    expect(names(chooseInLasso(body, tree, square(r.x - 6, r.y - 6, r.w + 12, r.h + 12), 20))).toEqual(['card1', 'card2']);
  });

  it('a wrapper of unboxed parts splits all the way to meaningful pieces', () => {
    const { body } = page();
    // The hero: a heading plus a plain wrapper around two buttons.
    expect(names(chooseInLasso(body, tree, square(30, 70, 960, 200), 20))).toEqual(['h1', 'btn1', 'btn2']);
  });

  it('keeps an element with its own text whole instead of listing its inline children', () => {
    const { body, cards } = page();
    const p = cards[0]!.children[1]!;
    expect(names(chooseInLasso(body, tree, ellipseAround(p.rect, 4), 20))).toEqual(['card1 p']);
  });

  it('skips hidden and zero-size nodes', () => {
    const hidden = node('hidden', { x: 10, y: 10, w: 20, h: 20 }, [], { hidden: true });
    const empty = node('empty', { x: 40, y: 10, w: 0, h: 20 });
    const shown = node('shown', { x: 70, y: 10, w: 20, h: 20 });
    const root = node('body', { x: 0, y: 0, w: 200, h: 200 }, [hidden, empty, shown]);
    expect(names(chooseInLasso(root, tree, square(0, 0, 150, 50), 20))).toEqual(['shown']);
  });

  it('never returns an element together with its ancestor', () => {
    const { body } = page();
    const chosen = chooseInLasso(body, tree, square(0, 0, 1100, 1100), 20);
    const contains = (a: Node, b: Node): boolean => a.children.some((c) => c === b || contains(c, b));
    for (const a of chosen) for (const b of chosen) expect(a !== b && contains(a, b)).toBe(false);
  });

  it('keeps a container whole when splitting it would pass the cap, and caps the result', () => {
    const items = Array.from({ length: 30 }, (_, i) => node(`li${i}`, { x: 10, y: 10 + i * 20, w: 100, h: 18 }, [], { text: true }));
    const list = node('ul', { x: 10, y: 10, w: 100, h: 600 }, items);
    const root = node('body', { x: 0, y: 0, w: 500, h: 1000 }, [list]);
    expect(names(chooseInLasso(root, tree, square(0, 0, 200, 700), 20))).toEqual(['ul']);
    const siblings = node('body', { x: 0, y: 0, w: 500, h: 1000 }, items);
    expect(chooseInLasso(siblings, tree, square(0, 0, 200, 700), 20)).toHaveLength(20);
  });

  it('selects nothing for a loop that encloses nothing whole', () => {
    const { body } = page();
    expect(chooseInLasso(body, tree, square(100, 90, 20, 20), 20)).toEqual([]);
    expect(chooseInLasso(body, tree, [{ x: 0, y: 0 }, { x: 5, y: 5 }], 20)).toEqual([]);
  });
});
