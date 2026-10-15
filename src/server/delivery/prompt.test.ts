import { describe, expect, it } from 'vitest';
import type { Comment } from '../../shared/protocol.js';
import { sampleComment } from '../comments/fixtures.js';
import { CLOSING_LINE, compactStyles, formatPrompt, type PromptContext, shellQuote } from './prompt.js';

const ctx: PromptContext = { cli: 'galley', cwd: '/work/site', origin: 'http://localhost:5300' };

function comment(overrides: Partial<Comment> = {}): Comment {
  return { ...sampleComment(), id: 'c_01ABC', createdAt: '2026-09-29T00:00:00.000Z', status: 'queued', ...overrides };
}

describe('formatPrompt', () => {
  it('formats one comment as a compact block', () => {
    const text = formatPrompt([comment({ screenshot: '/work/site/.galley/shots/c_01ABC.png' })], ctx);
    expect(text).toBe(
      [
        'I left this comment on my page in the browser with galley. Please make the change:',
        '',
        '[c_01ABC] Make the heading bigger',
        'Page: http://localhost:5300/?tab=1 (viewport 1280x800 @2x)',
        'Element: <h1.title> src/App.tsx:4:7',
        '  selector: body > main > h1',
        '  text: "Hello"',
        '  styles: font 32px/40px 700; color rgb(0,0,0)',
        'Screenshot: /work/site/.galley/shots/c_01ABC.png',
        'Done: galley done c_01ABC "<note>" --cwd /work/site',
        'Fail: galley fail c_01ABC "<reason>" --cwd /work/site',
        '',
        CLOSING_LINE,
      ].join('\n'),
    );
  });

  it('numbers comments and elements in a batch and ends with the closing line', () => {
    const first = comment({ id: 'c_1' });
    const second = comment({ id: 'c_2', text: 'Line one\nLine two', elements: [...first.elements, { ...first.elements[0]!, src: undefined, selector: '#b' }] });
    const text = formatPrompt([first, second], ctx);
    expect(text.startsWith('I left 2 comments on my page in the browser with galley. Please handle each one:')).toBe(true);
    expect(text).toContain('1. [c_1] Make the heading bigger');
    expect(text).toContain('2. [c_2] \n  Line one\n  Line two');
    expect(text).toContain('Element 2: <h1.title> no source location\n  selector: #b');
    expect(text).toContain('Done: galley done c_2 "<note>" --cwd /work/site');
    expect(text.endsWith(CLOSING_LINE)).toBe(true);
    expect(text.match(/Make the change/g)).toHaveLength(1);
  });

  it('describes lasso selections and console errors', () => {
    const text = formatPrompt(
      [comment({ mode: 'lasso', commonAncestor: 'main > ul', errors: [{ message: 'boom', stack: 'Error: boom\n at a.js:1\n at b.js:2', at: 'x' }] })],
      ctx,
    );
    expect(text).toContain('Lasso selection: 1 element inside main > ul');
    expect(text).toContain('Console errors (1):\n  - boom\n    Error: boom\n    at a.js:1');
  });

  it('keeps absolute URLs and omits the screenshot line when there is none', () => {
    const text = formatPrompt([comment({ url: 'http://localhost:5173/x', viewport: { w: 390, h: 844, dpr: 1 } })], ctx);
    expect(text).toContain('Page: http://localhost:5173/x (viewport 390x844)');
    expect(text).not.toContain('Screenshot:');
  });

  it('shortens long element text and class lists', () => {
    const element = { ...comment().elements[0]!, text: 'word '.repeat(60), classes: ['a', 'b', 'c', 'd'] };
    const text = formatPrompt([comment({ elements: [element] })], ctx);
    expect(text).toContain('<h1.a.b.c…>');
    expect(text).toMatch(/text: "(word ){20,}word…"/);
  });

  it('quotes a cwd with spaces so the done command runs from anywhere', () => {
    const text = formatPrompt([comment()], { ...ctx, cli: "node '/My Apps/galley/bin/galley.js'", cwd: "/Users/me/it's here" });
    expect(text).toContain(`Done: node '/My Apps/galley/bin/galley.js' done c_01ABC "<note>" --cwd '/Users/me/it'\\''s here'`);
  });

  it('says when comments were sent together as one batch', () => {
    const batch = [comment({ id: 'c_1', batch: 'b_42' }), comment({ id: 'c_2', batch: 'b_42' }), comment({ id: 'c_3', batch: 'b_42' })];
    const text = formatPrompt(batch, ctx);
    expect(text.split('\n')[0]).toBe(
      'I left 3 related comments on my page in the browser with galley, sent together as one request (batch b_42). ' +
        'Read them all before editing, since they may touch the same code, then handle each one:',
    );
    expect(text).toContain('1. [c_1]');
    expect(text).toContain('3. [c_3]');
    expect(text.match(/Make the change/g)).toHaveLength(1);
  });

  it('uses the plain header when comments come from different batches or none', () => {
    const mixed = formatPrompt([comment({ id: 'c_1', batch: 'b_1' }), comment({ id: 'c_2', batch: 'b_2' })], ctx);
    expect(mixed.startsWith('I left 2 comments on my page in the browser with galley. Please handle each one:')).toBe(true);
    const partly = formatPrompt([comment({ id: 'c_1', batch: 'b_1' }), comment({ id: 'c_2' })], ctx);
    expect(partly.startsWith('I left 2 comments on my page in the browser with galley')).toBe(true);
    expect(formatPrompt([comment({ batch: 'b_1' })], ctx).startsWith('I left this comment on my page in the browser with galley. Please make the change:')).toBe(true);
  });

  it('formats an elementless fix request with its error and stack', () => {
    const error = { message: 'Error: boom', stack: 'Error: boom\n    at onClick (src/App.tsx:3:9)', at: 'x' };
    const text = formatPrompt([comment({ text: 'Fix this error: Error: boom', elements: [], errors: [error] })], ctx);
    expect(text).toContain('[c_01ABC] Fix this error: Error: boom\nPage: http://localhost:5300/?tab=1');
    expect(text).not.toContain('Element');
    expect(text).toContain('Console errors (1):\n  - Error: boom\n    at onClick (src/App.tsx:3:9)');
  });

  it('refuses an empty batch', () => {
    expect(() => formatPrompt([], ctx)).toThrow();
  });
});

describe('compactStyles', () => {
  it('drops default values', () => {
    expect(
      compactStyles({
        fontSize: '16px',
        fontWeight: '400',
        lineHeight: 'normal',
        color: 'rgb(17, 17, 17)',
        backgroundColor: 'rgb(255, 255, 255)',
        padding: '8px 12px',
        margin: '0px',
        gap: '4px',
        borderRadius: '6px',
      }),
    ).toBe('font 16px/normal 400; color rgb(17,17,17); bg rgb(255,255,255); padding 8px 12px; gap 4px; radius 6px');
  });
});

describe('shellQuote', () => {
  it('leaves plain paths alone and quotes the rest', () => {
    expect(shellQuote('/a/b-c_d.e')).toBe('/a/b-c_d.e');
    expect(shellQuote('/a b')).toBe(`'/a b'`);
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });
});
