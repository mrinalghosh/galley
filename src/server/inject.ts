// Injects the overlay script into proxied HTML documents.
import { PREFIX } from '../shared/constants.js';

export const OVERLAY_SRC = `${PREFIX}/overlay.js`;
export const OVERLAY_TAG = `<script src="${OVERLAY_SRC}"></script>`;

/**
 * Inserts the overlay tag before `</head>`. Pages without a head get it before
 * `<body>`, then after `<html>`, then after the doctype, then at the start.
 * Idempotent: a page that already loads the overlay is returned unchanged.
 *
 * Works on any ASCII-compatible text; callers decode bytes as latin1 so that
 * non-UTF-8 pages survive the round trip byte for byte.
 */
export function injectOverlay(html: string): string {
  if (html.includes(OVERLAY_SRC)) return html;

  const headClose = html.search(/<\/head\s*>/i);
  if (headClose >= 0) return insertAt(html, headClose);

  const bodyOpen = html.search(/<body[\s>]/i);
  if (bodyOpen >= 0) return insertAt(html, bodyOpen);

  const afterHtml = endOfTag(html, /<html[\s>]/i);
  if (afterHtml >= 0) return insertAt(html, afterHtml);

  const afterDoctype = endOfTag(html, /<!doctype[\s>]/i);
  if (afterDoctype >= 0) return insertAt(html, afterDoctype);

  return OVERLAY_TAG + html;
}

function insertAt(html: string, index: number): string {
  return html.slice(0, index) + OVERLAY_TAG + html.slice(index);
}

/** Index just past the `>` of the first tag matching `open`, or -1. */
function endOfTag(html: string, open: RegExp): number {
  const start = html.search(open);
  if (start < 0) return -1;
  const close = html.indexOf('>', start);
  return close < 0 ? -1 : close + 1;
}

/** Injects into raw document bytes. See injectOverlay for why this goes through latin1. */
export function injectOverlayBytes(body: Buffer): Buffer {
  return Buffer.from(injectOverlay(body.toString('latin1')), 'latin1');
}
