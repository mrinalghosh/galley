// Verifies the galley Vite plugin end to end: every element React renders in the running sample
// carries data-galley-src, and that file:line:col opens on the JSX tag that renders it.
// Usage: start the sample (`npm run dev`), then `npm run check:sources [url]`.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5210/';
const root = new URL('.', import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
await page.waitForSelector('#root h1');

const collect = () =>
  page.$$eval('#root *', (elements) =>
    elements.map((el) => ({ tag: el.tagName.toLowerCase(), src: el.getAttribute('data-galley-src') })),
  );

// Two states: the initial page, and after submitting the form (renders the thank-you notice instead).
const initial = await collect();
await page.fill('input[name=email]', 'dev@example.com');
await page.click('form button[type=submit]');
await page.waitForSelector('.notice');
const submitted = await collect();
await browser.close();

const files = new Map();
const lineAt = (file, line) => {
  if (!files.has(file)) files.set(file, readFileSync(new URL(file, root), 'utf8').split('\n'));
  return files.get(file)[line - 1];
};

const failures = [];
const locations = new Set();
const all = [...initial, ...submitted];
for (const { tag, src } of all) {
  const match = src?.match(/^(.+):(\d+):(\d+)$/);
  if (!match) {
    failures.push(`<${tag}> has no usable data-galley-src (${src})`);
    continue;
  }
  const [, file, line, col] = match;
  locations.add(src);
  const text = lineAt(file, Number(line))?.slice(Number(col) - 1) ?? '';
  if (!new RegExp(`^<${tag}(?![\\w.:-])`).test(text)) failures.push(`<${tag}> ${src} opens on: ${text.slice(0, 40)}`);
}

const passed = all.length - failures.length;
console.log(`elements checked: ${all.length} (${initial.length} initial + ${submitted.length} after submit), ${locations.size} distinct source locations`);
console.log(`passed: ${passed}/${all.length} (${((passed / all.length) * 100).toFixed(1)}%)`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
