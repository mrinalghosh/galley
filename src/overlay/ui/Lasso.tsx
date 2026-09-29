import { useLayoutEffect, useRef } from 'preact/hooks';
import { addPoint, type Point, polygonBounds, smoothPath } from '../lasso.js';

/** A loop smaller than this (CSS px, either side) is a stray click, not a lasso. */
const MIN_SIZE = 6;

/** Everything a drag is made of. None of it may reach the site while it lands on our layer. */
const CONSUMED = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'] as const;

export interface LassoCallbacks {
  /** The loop in progress, or undefined once it is cancelled. */
  onDraft(points: Point[] | undefined): void;
  onCommit(points: Point[]): void;
}

/**
 * Freehand drag on the lasso layer. Listens on window in the capture phase, like
 * the picker, so the site's own capture listeners never see the drag. Points
 * are page coordinates, so the loop stays where it was drawn if the page
 * scrolls mid-drag. Lives outside Preact state so Esc can cancel it synchronously.
 */
export class LassoGesture {
  private layer: Element | undefined;
  private pointerId: number | undefined;
  private points: Point[] = [];

  constructor(private callbacks: LassoCallbacks) {}

  get drawing(): boolean {
    return this.pointerId !== undefined;
  }

  start(layer: Element): void {
    this.stop();
    this.layer = layer;
    for (const type of CONSUMED) window.addEventListener(type, this.onEvent, true);
  }

  stop(): void {
    if (!this.layer) return;
    this.cancel();
    for (const type of CONSUMED) window.removeEventListener(type, this.onEvent, true);
    this.layer = undefined;
  }

  /** Esc: drops the loop being drawn. Returns false when there was none. */
  cancel = (): boolean => {
    if (!this.drawing) return false;
    this.reset();
    this.callbacks.onDraft(undefined);
    return true;
  };

  private onEvent = (event: Event): void => {
    // Events on the composer, toolbar or panel sit above the layer and pass through.
    if (!this.layer || !event.composedPath().includes(this.layer)) return;
    event.stopImmediatePropagation();
    if (event.type === 'pointerdown' || event.type === 'mousedown' || event.type === 'contextmenu') event.preventDefault();
    if (!(event instanceof PointerEvent)) return;
    if (event.type === 'pointerdown') this.down(event);
    else if (event.pointerId !== this.pointerId) return;
    else if (event.type === 'pointermove') this.move(event);
    else if (event.type === 'pointerup') this.up();
    else if (event.type === 'pointercancel') this.cancel();
  };

  private down(event: PointerEvent): void {
    if (event.button !== 0 || this.drawing) return;
    // Keeps the moves coming to the layer (and so to us) even outside the frame.
    this.layer?.setPointerCapture(event.pointerId);
    this.pointerId = event.pointerId;
    this.points = [pagePoint(event)];
    this.callbacks.onDraft(this.points);
  }

  private move(event: PointerEvent): void {
    const next = addPoint(this.points, pagePoint(event));
    if (next === this.points) return;
    this.points = next;
    this.callbacks.onDraft(next);
  }

  private up(): void {
    const points = this.points;
    this.reset();
    const bounds = polygonBounds(points);
    if (points.length >= 3 && bounds.w >= MIN_SIZE && bounds.h >= MIN_SIZE) this.callbacks.onCommit(points);
    else this.callbacks.onDraft(undefined);
  }

  private reset(): void {
    this.pointerId = undefined;
    this.points = [];
  }
}

function pagePoint(event: PointerEvent): Point {
  return { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY };
}

interface Props {
  /** True while the lasso tool is on: the layer takes the pointer. */
  active: boolean;
  gesture: LassoGesture;
  /** Loop being drawn, else the one behind the open composer. Page coordinates. */
  points?: Point[];
}

/** Full-frame SVG the lasso is drawn on. */
export function LassoLayer({ active, gesture, points }: Props) {
  const layer = useRef<SVGSVGElement>(null);
  // Layout effect: listening must start with the render that shows the layer,
  // or a quick drag right after pressing L is missed.
  useLayoutEffect(() => {
    if (!active || !layer.current) return;
    gesture.start(layer.current);
    return () => gesture.stop();
  }, [active, gesture]);

  if (!active && !points) return null;
  const inView = points?.map((p) => ({ x: p.x - window.scrollX, y: p.y - window.scrollY }));
  return (
    <svg ref={layer} class={`lasso-layer ${active ? 'lasso-active' : ''}`} data-galley="lasso-layer">
      {inView && <path class="lasso-path" d={smoothPath(inView)} />}
    </svg>
  );
}
