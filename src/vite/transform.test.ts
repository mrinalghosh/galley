import { describe, expect, it } from 'vitest';
import { SourceMapConsumer } from 'source-map-js';
import { addSourceAttributes } from './transform.js';

const ID = '/project/src/App.tsx';
const FILE = 'src/App.tsx';

function transform(code: string, id = ID) {
  return addSourceAttributes(code, id, FILE);
}

/** Every data-galley-src value in the output, in order. */
function sources(code: string): string[] {
  return [...code.matchAll(/data-galley-src="([^"]+)"/g)].map((match) => match[1]!);
}

describe('addSourceAttributes', () => {
  it('tags host elements only', () => {
    const code = [
      'export const App = () => (',
      '  <>',
      '    <div>',
      '      <Card />',
      '      <ui.Button />',
      '      <svg:rect />',
      '      <span>hi</span>',
      '    </div>',
      '  </>',
      ');',
    ].join('\n');

    const out = transform(code)!.code;

    expect(out).toContain(`<div data-galley-src="${FILE}:3:5">`);
    expect(out).toContain(`<span data-galley-src="${FILE}:7:7">hi</span>`);
    expect(out).toContain('<Card />');
    expect(out).toContain('<ui.Button />');
    expect(out).toContain('<svg:rect />');
    expect(out).toContain('<>');
    expect(sources(out)).toHaveLength(2);
  });

  it('points line and 1-based column at the opening <', () => {
    const code = ['function A() {', '  return <main className="x">', '\t\t<p>text</p>', '  </main>;', '}'].join('\n');

    const out = transform(code)!.code;

    expect(sources(out)).toEqual([`${FILE}:2:10`, `${FILE}:3:3`]);
    const lines = code.split('\n');
    for (const src of sources(out)) {
      const [, line, col] = src.split(':').map(Number) as [number, number, number];
      expect(lines[line - 1]!.slice(col - 1)).toMatch(/^<(main|p)\b/);
    }
  });

  it('inserts right after the tag name, before existing attributes', () => {
    const out = transform('const a = <input type="text" {...rest} disabled />;')!.code;
    expect(out).toBe(`const a = <input data-galley-src="${FILE}:1:11" type="text" {...rest} disabled />;`);
  });

  it('leaves an element that already has the attribute untouched', () => {
    const code = 'const a = <div data-galley-src="custom:1:1"><b /></div>;';
    const out = transform(code)!.code;
    expect(out).toContain('<div data-galley-src="custom:1:1">');
    expect(out).toContain(`<b data-galley-src="${FILE}:1:45" />`);
  });

  it('returns null when there is nothing to tag', () => {
    expect(transform('export const x = <Card />;')).toBeNull();
    expect(transform('export const n: number = 1;')).toBeNull();
  });

  it('parses TS generics, arrow functions and type assertions in .tsx', () => {
    const code = [
      'type Props<T> = { items: T[]; render: (item: T) => string };',
      'export const List = <T,>({ items, render }: Props<T>) => (',
      '  <ul>{items.map((item) => <li key={render(item)}>{render(item)}</li>)}</ul>',
      ');',
      'export function Box<T extends object>(props: T) {',
      '  const value = props as unknown as { label: string };',
      '  return <section>{value.label satisfies string}</section>;',
      '}',
    ].join('\n');

    const result = transform(code);

    expect(result).not.toBeNull();
    expect(sources(result!.code)).toEqual([`${FILE}:3:3`, `${FILE}:3:28`, `${FILE}:7:10`]);
  });

  it('parses plain JSX in .jsx files', () => {
    const result = addSourceAttributes('export const A = () => <div className="a" />;', '/project/src/A.jsx', 'src/A.jsx');
    expect(sources(result!.code)).toEqual(['src/A.jsx:1:24']);
  });

  it('returns null on a syntax error instead of throwing', () => {
    expect(transform('export const A = () => <div>;')).toBeNull();
    expect(transform('const = ;')).toBeNull();
  });

  it('escapes quotes and ampersands in the path', () => {
    const result = addSourceAttributes('const a = <p />;', ID, 'src/a&"b.tsx');
    expect(result!.code).toContain('data-galley-src="src/a&amp;&quot;b.tsx:1:11"');
  });

  it('produces a source map that maps shifted code back to the original', () => {
    const code = ['export const A = () => (', '  <div className="a">', '    <span>one</span>', '  </div>', ');'].join('\n');
    const result = transform(code)!;
    const consumer = new SourceMapConsumer(result.map as unknown as ConstructorParameters<typeof SourceMapConsumer>[0]);
    const outLines = result.code.split('\n');

    // `className` on line 2 and `one` on line 3 sit after an inserted attribute in the output.
    for (const [token, line, column] of [
      ['className', 2, 7],
      ['one', 3, 10],
    ] as const) {
      const generatedColumn = outLines[line - 1]!.indexOf(token);
      const original = consumer.originalPositionFor({ line, column: generatedColumn });
      expect(original).toMatchObject({ source: ID, line, column });
    }
    expect(consumer.sourceContentFor(ID)).toBe(code);
  });
});
