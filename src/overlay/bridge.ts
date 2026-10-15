// Talks to the galley shell when the page is framed by it. In direct mode the
// overlay shows its own toolbar instead.
import { PREFIX } from '../shared/constants.js';
import type { OverlayToShell, ShellToOverlay } from '../shared/protocol.js';

export type Mode = 'shell' | 'direct' | 'nested';

export function detectMode(): Mode {
  if (window.parent === window) return 'direct';
  try {
    const parent = window.parent.location;
    if (parent.origin === location.origin && parent.pathname.startsWith(PREFIX)) return 'shell';
  } catch {
    // Cross-origin parent: not our shell.
  }
  // An iframe inside the site: stay out of the way.
  return 'nested';
}

export function postToShell(message: OverlayToShell): void {
  window.parent.postMessage(message, location.origin);
}

export function onShellMessage(handler: (message: ShellToOverlay) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const data = event.data as Partial<ShellToOverlay> | null;
    if (!data || data.source !== 'galley-shell' || typeof data.type !== 'string') return;
    handler(data as ShellToOverlay);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
