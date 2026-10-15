// postMessage between the shell and the overlay running in the site frame.
import type { OverlayToShell, ShellToOverlay } from '../shared/protocol.js';

export type Tool = 'pick' | 'lasso' | 'none';

export function postToOverlay(frame: HTMLIFrameElement | null, message: ShellToOverlay): void {
  frame?.contentWindow?.postMessage(message, location.origin);
}

/**
 * Calls `handler` for overlay messages from our own frame. Anything else
 * (other origins, other windows, the site's own messages) is ignored.
 * Returns an unsubscribe function.
 */
export function onOverlayMessage(getFrame: () => HTMLIFrameElement | null, handler: (message: OverlayToShell) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.origin !== location.origin) return;
    if (event.source !== getFrame()?.contentWindow) return;
    const data = event.data as Partial<OverlayToShell> | null;
    if (!data || typeof data !== 'object' || data.source !== 'galley-overlay') return;
    handler(data as OverlayToShell);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
