// Right-hand terminal drawer. M1 ships the frame (collapse, resize); M4 mounts
// the terminal into #galley-terminal.
import { useRef } from 'preact/hooks';
import { ChevronRightIcon, TerminalIcon } from './icons.js';
import { TerminalPanel } from './terminal/TerminalPanel.js';

export const DRAWER_MIN = 280;

interface DrawerProps {
  open: boolean;
  width: number;
  onOpen(open: boolean): void;
  onResize(width: number): void;
  /** True while dragging, so the stage can stop the iframe from swallowing pointer events. */
  onDragging(dragging: boolean): void;
  cwd: string;
}

export function Drawer({ open, width, onOpen, onResize, onDragging, cwd }: DrawerProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  if (!open) {
    return (
      <aside class="g-drawer g-drawer-collapsed">
        <button class="g-drawer-tab" title="Open terminal" onClick={() => onOpen(true)}>
          <TerminalIcon />
          <span>Terminal</span>
        </button>
      </aside>
    );
  }

  const onPointerDown = (event: PointerEvent) => {
    drag.current = { startX: event.clientX, startWidth: width };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    onDragging(true);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag.current) return;
    const max = Math.floor(window.innerWidth * 0.7);
    const next = drag.current.startWidth + (drag.current.startX - event.clientX);
    onResize(Math.max(DRAWER_MIN, Math.min(max, next)));
  };
  const onPointerUp = () => {
    drag.current = null;
    onDragging(false);
  };

  return (
    <aside class="g-drawer" style={{ width: `${width}px` }}>
      <div
        class="g-drawer-handle"
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div class="g-drawer-head">
        <TerminalIcon />
        <span title={cwd}>Terminal</span>
        <button class="g-btn g-drawer-close" title="Collapse" onClick={() => onOpen(false)}>
          <ChevronRightIcon />
        </button>
      </div>
      <div class="g-drawer-body" id="galley-terminal">
        <TerminalPanel />
      </div>
    </aside>
  );
}
