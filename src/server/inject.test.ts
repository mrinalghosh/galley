import { describe, expect, it } from 'vitest';
import { OVERLAY_TAG, injectOverlay, injectOverlayBytes } from './inject.js';

describe('injectOverlay', () => {
  it('inserts before </head>', () => {
    const html = '<!doctype html><html><head><title>x</title></head><body>hi</body></html>';
    expect(injectOverlay(html)).toBe(`<!doctype html><html><head><title>x</title>${OVERLAY_TAG}</head><body>hi</body></html>`);
  });

  it('matches </head> case-insensitively and with whitespace', () => {
    expect(injectOverlay('<HEAD></HEAD >')).toBe(`<HEAD>${OVERLAY_TAG}</HEAD >`);
  });

  it('falls back to before <body> when there is no </head>', () => {
    expect(injectOverlay('<html><body class="a">x</body></html>')).toBe(`<html>${OVERLAY_TAG}<body class="a">x</body></html>`);
  });

  it('does not mistake <bodyish> for <body>', () => {
    expect(injectOverlay('<html lang="en"><bodyish>')).toBe(`<html lang="en">${OVERLAY_TAG}<bodyish>`);
  });

  it('falls back to after the doctype, then to the start', () => {
    expect(injectOverlay('<!DOCTYPE html><p>x')).toBe(`<!DOCTYPE html>${OVERLAY_TAG}<p>x`);
    expect(injectOverlay('<p>fragment</p>')).toBe(`${OVERLAY_TAG}<p>fragment</p>`);
    expect(injectOverlay('')).toBe(OVERLAY_TAG);
  });

  it('injects once', () => {
    const once = injectOverlay('<head></head>');
    expect(injectOverlay(once)).toBe(once);
  });

  it('keeps non-ASCII bytes intact whatever the charset', () => {
    const utf8 = Buffer.from('<head><title>café ✓</title></head>', 'utf8');
    const out = injectOverlayBytes(utf8).toString('utf8');
    expect(out).toBe(`<head><title>café ✓</title>${OVERLAY_TAG}</head>`);

    const latin1 = Buffer.from([...Buffer.from('<head>'), 0xe9, ...Buffer.from('</head>')]);
    const injected = injectOverlayBytes(latin1);
    expect(injected.includes(0xe9)).toBe(true);
    expect(injected.length).toBe(latin1.length + OVERLAY_TAG.length);
  });
});
