import type { Rect } from '../../shared/protocol.js';

interface Props {
  rect: Rect;
  kind: 'hover' | 'selected';
  label?: string;
}

/** Outline drawn over a page element, in viewport coordinates. */
export function Highlight({ rect, kind, label }: Props) {
  const style = { transform: `translate(${rect.x}px, ${rect.y}px)`, width: `${rect.w}px`, height: `${rect.h}px` };
  const below = rect.y < 24;
  return (
    <div class={`box box-${kind}`} style={style}>
      {label && <span class={`box-label ${below ? 'box-label-below' : ''}`}>{label}</span>}
    </div>
  );
}

/** Short description, e.g. "h1.title 320×40". */
export function describe(el: Element, rect: Rect): string {
  const id = el.id ? `#${el.id}` : '';
  const classes = Array.from(el.classList).slice(0, 2).map((c) => `.${c}`).join('');
  return `${el.localName}${id}${classes} ${Math.round(rect.w)}×${Math.round(rect.h)}`;
}
