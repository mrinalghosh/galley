// Overlay entry, injected into every proxied HTML page. Renders into a shadow
// root on one host element so the site's CSS and ours never meet.
import { render } from 'preact';
import { OVERLAY_HOST_TAG, PREFIX } from '../shared/constants.js';
import { detectMode } from './bridge.js';
import { captureErrors, ErrorRing } from './errors.js';
import styles from './styles.css';
import { App } from './ui/App.js';

declare global {
  interface Window {
    __galleyOverlay?: boolean;
    __galleyErrors?: ErrorRing;
  }
}

/**
 * Starts console capture right away, while the page is still parsing, so
 * errors thrown by the site's first scripts are caught too. Returns the ring,
 * or undefined where the overlay doesn't run.
 */
function startCapture(): ErrorRing | undefined {
  if (location.pathname.startsWith(PREFIX) || detectMode() === 'nested') return undefined;
  // Injected twice: keep the first ring, so each error is recorded once.
  if (!window.__galleyErrors) {
    window.__galleyErrors = new ErrorRing();
    captureErrors(window, window.__galleyErrors);
  }
  return window.__galleyErrors;
}

function mount(errors: ErrorRing): void {
  // Injected twice (e.g. a page that re-inserts its head).
  if (window.__galleyOverlay) return;
  const mode = detectMode();
  if (mode === 'nested') return;
  window.__galleyOverlay = true;

  const host = document.createElement(OVERLAY_HOST_TAG);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = styles;
  const root = document.createElement('div');
  shadow.append(style, root);
  document.documentElement.appendChild(host);
  render(<App host={host} mode={mode} errors={errors} />, root);
}

const errors = startCapture();
if (errors) {
  // The script runs in <head>; waiting keeps our host after <body> instead of before it.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount(errors), { once: true });
  else mount(errors);
}
