// Pick mode input handling. Listens on window in the capture phase, so the
// site's own handlers never see the clicks that select an element.
import { elementAt } from './capture.js';

export interface PickerCallbacks {
  onHover(el: Element | undefined): void;
  onPick(el: Element, additive: boolean): void;
}

// Everything a click is made of; blocking only `click` would still let the
// site react to mousedown/pointerdown (focus, drag starts, menus).
const BLOCKED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'] as const;

export class Picker {
  private active = false;
  private hovered: Element | undefined;
  /** Element under the pointer, used to walk back down after Alt+Up. */
  private pointed: Element | undefined;
  private lastPoint: { x: number; y: number } | undefined;

  constructor(
    private host: Element,
    private callbacks: PickerCallbacks,
  ) {
    // Track the pointer even while idle, so pressing C highlights immediately.
    window.addEventListener('pointermove', this.trackPoint, { capture: true, passive: true });
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('pointermove', this.trackPoint, true);
  }

  get isActive(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    for (const type of BLOCKED) window.addEventListener(type, this.onBlocked, true);
    if (this.lastPoint) this.hoverAt(this.lastPoint.x, this.lastPoint.y);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('scroll', this.onScroll, true);
    for (const type of BLOCKED) window.removeEventListener(type, this.onBlocked, true);
    this.setHovered(undefined);
    this.pointed = undefined;
  }

  /** Alt+Up / Alt+Down: move the highlight to the parent, or back toward the pointer. */
  walk(direction: 'up' | 'down'): void {
    const current = this.hovered;
    if (!current) return;
    if (direction === 'up') {
      const parent = current.parentElement;
      if (parent && parent !== document.documentElement) this.setHovered(parent);
      return;
    }
    this.setHovered(childToward(current, this.pointed) ?? current.firstElementChild ?? current);
  }

  private fromOverlay(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  private hoverAt(x: number, y: number): void {
    const el = elementAt(x, y);
    this.pointed = el;
    this.setHovered(el);
  }

  private setHovered(el: Element | undefined): void {
    if (el === this.hovered) return;
    this.hovered = el;
    this.callbacks.onHover(el);
  }

  private trackPoint = (event: PointerEvent): void => {
    this.lastPoint = { x: event.clientX, y: event.clientY };
  };

  private onMove = (event: PointerEvent): void => {
    if (this.fromOverlay(event)) return this.setHovered(undefined);
    this.hoverAt(event.clientX, event.clientY);
  };

  private onScroll = (): void => {
    if (this.lastPoint) this.hoverAt(this.lastPoint.x, this.lastPoint.y);
  };

  private onBlocked = (event: Event): void => {
    if (this.fromOverlay(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'click' || !(event instanceof MouseEvent) || event.button !== 0) return;
    const target = this.hovered ?? elementAt(event.clientX, event.clientY);
    if (target) this.callbacks.onPick(target, event.shiftKey);
  };
}

/** The child of `ancestor` on the path down to `descendant`. */
function childToward(ancestor: Element, descendant: Element | undefined): Element | undefined {
  let current = descendant;
  while (current && current.parentElement !== ancestor) current = current.parentElement ?? undefined;
  return current;
}

/** True while the user is typing somewhere, so single-key shortcuts must not fire. */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0];
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
