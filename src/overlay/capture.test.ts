// Runs capture.ts in real Chromium: selectors, text, rects and styles depend on layout.
import * as esbuild from 'esbuild';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ElementInfo } from '../shared/protocol.js';

let browser: Browser;
let page: Page;
let bundle: string;

const FIXTURE = `<!doctype html>
<html><head><style>
  body { margin: 0; font-family: sans-serif; }
  .spacer { height: 1500px; }
  h1 { font-size: 40px; font-weight: 700; margin: 8px 0; padding: 4px 12px; color: rgb(10, 20, 30); }
  ul { display: flex; gap: 6px; }
  .hidden { display: none; }
</style></head>
<body>
  <nav id="top"><a href="#">Home</a><a href="#">Docs</a></nav>
  <main data-galley-src="src/App.tsx:10:5">
    <section>
      <h1 class="title big">  Ship   calmer
        releases <span class="hidden">secret</span></h1>
      <p>One</p><p>Two <b>bold</b></p>
      <button data-testid="save">Save</button>
      <button data-testid="dup">A</button><button data-testid="dup">B</button>
      <div id=":r1:">generated id</div>
      <div id="dup-id">first</div><div id="dup-id">second</div>
    </section>
    <ul id="cards"><li>1</li><li>2</li><li data-galley-src="src/Card.tsx:3:7">${'x'.repeat(300)}</li></ul>
  </main>
  <div class="spacer"></div>
  <footer><p>foot</p></footer>
</body></html>`;

type Capture = typeof import('./capture.js');

beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: ['src/overlay/capture.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'galleyCapture',
    target: 'es2020',
  });
  bundle = result.outputFiles[0]!.text;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  await page.setContent(FIXTURE);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addScriptTag({ content: bundle });
});

/** Runs a capture function on the element matched by `query`. */
function run<T>(query: string, fn: keyof Capture): Promise<T> {
  return page.evaluate(
    ([q, name]) => {
      const capture = (window as unknown as { galleyCapture: Record<string, (el: Element) => unknown> }).galleyCapture;
      const el = document.querySelector(q)!;
      return capture[name]!(el) as T;
    },
    [query, fn] as const,
  );
}

async function selectorMatchesOnly(selector: string, query: string): Promise<boolean> {
  return page.evaluate(([s, q]) => {
    const all = document.querySelectorAll(s);
    return all.length === 1 && all[0] === document.querySelector(q);
  }, [selector, query] as const);
}

describe('selectorFor', () => {
  it('prefers a unique id', async () => {
    expect(await run('nav', 'selectorFor')).toBe('#top');
  });

  it('uses data-testid when there is no id', async () => {
    expect(await run('[data-testid="save"]', 'selectorFor')).toBe('[data-testid="save"]');
  });

  it('builds an nth-of-type path, anchored at the nearest id', async () => {
    expect(await run('#cards > li:nth-child(2)', 'selectorFor')).toBe('#cards > li:nth-of-type(2)');
    expect(await run('h1', 'selectorFor')).toBe('body > main > section > h1');
    expect(await run('section > p:nth-of-type(2) > b', 'selectorFor')).toBe('body > main > section > p:nth-of-type(2) > b');
  });

  it('skips duplicate test ids, duplicate ids and generated ids, and stays unique', async () => {
    for (const query of ['[data-testid="dup"]:nth-of-type(3)', '#dup-id ~ #dup-id', '[id=":r1:"]']) {
      const selector = await run<string>(query, 'selectorFor');
      expect(selector).not.toContain('dup');
      expect(selector).not.toContain(':r1:');
      expect(await selectorMatchesOnly(selector, query)).toBe(true);
    }
  });
});

describe('captureElement', () => {
  it('records tag, classes, visible text, source, styles and page rect', async () => {
    await page.evaluate(() => window.scrollTo(0, 50));
    const info = await run<ElementInfo>('h1', 'captureElement');
    expect(info).toMatchObject({
      selector: 'body > main > section > h1',
      tag: 'h1',
      classes: ['title', 'big'],
      text: 'Ship calmer releases',
      src: 'src/App.tsx:10:5',
    });
    expect(info.styles).toMatchObject({ fontSize: '40px', fontWeight: '700', color: 'rgb(10, 20, 30)', padding: '4px 12px', margin: '8px 0px' });
    const expected = await page.evaluate(() => {
      const r = document.querySelector('h1')!.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    });
    expect(info.rect.y).toBeCloseTo(expected.y, 0);
    expect(info.rect.x).toBeCloseTo(expected.x, 0);
    expect(info.rect.w).toBeCloseTo(expected.w, 0);
  });

  it('caps text at 200 characters and takes the nearest tagged ancestor', async () => {
    const info = await run<ElementInfo>('#cards > li:nth-child(3)', 'captureElement');
    expect(info.text).toHaveLength(200);
    expect(info.src).toBe('src/Card.tsx:3:7');
    expect((await run<ElementInfo>('ul', 'captureElement')).styles.gap).toBe('6px');
  });

  it('omits src when no ancestor is tagged', async () => {
    expect(await run<ElementInfo>('footer p', 'captureElement')).not.toHaveProperty('src');
  });
});

describe('resolveElement and elementAt', () => {
  it('finds a heading again after it is replaced by a new node', async () => {
    const info = await run<ElementInfo>('h1', 'captureElement');
    const found = await page.evaluate((stored) => {
      const old = document.querySelector('h1')!;
      const fresh = document.createElement('h1');
      fresh.textContent = 'Ship faster releases';
      old.replaceWith(fresh);
      const capture = (window as unknown as { galleyCapture: Capture }).galleyCapture;
      const el = capture.resolveElement(stored);
      return el === fresh && el.isConnected;
    }, info);
    expect(found).toBe(true);
  });

  it('skips the overlay host when hit-testing', async () => {
    const hit = await page.evaluate(() => {
      const host = document.createElement('galley-overlay');
      host.setAttribute('style', 'position:fixed;inset:0;z-index:999');
      document.documentElement.appendChild(host);
      const h1 = document.querySelector('h1')!.getBoundingClientRect();
      const capture = (window as unknown as { galleyCapture: Capture }).galleyCapture;
      return capture.elementAt(h1.left + 5, h1.top + h1.height / 2)?.localName;
    });
    expect(hit).toBe('h1');
  });

  it('finds the nearest common ancestor', async () => {
    const tag = await page.evaluate(() => {
      const capture = (window as unknown as { galleyCapture: Capture }).galleyCapture;
      return capture.commonAncestor([document.querySelector('h1')!, document.querySelector('#cards li')!])?.localName;
    });
    expect(tag).toBe('main');
  });
});
