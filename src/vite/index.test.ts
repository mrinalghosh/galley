import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from 'vite';
import galley, { type GalleyViteOptions } from './index.js';

const ROOT = '/work/site';
const CODE = 'export const A = () => <div />;';

function setup(options?: GalleyViteOptions) {
  const plugin = galley(options);
  (plugin.configResolved as (config: ResolvedConfig) => void)({ root: ROOT } as ResolvedConfig);
  const transform = plugin.transform as (code: string, id: string) => { code: string } | null;
  return { plugin, run: (id: string, code = CODE) => transform(code, id)?.code ?? null };
}

describe('galley vite plugin', () => {
  it('runs first, during serve only', () => {
    const { plugin } = setup();
    expect(plugin).toMatchObject({ name: 'galley', apply: 'serve', enforce: 'pre' });
  });

  it('uses a POSIX path relative to the Vite root, ignoring query strings', () => {
    const { run } = setup();
    expect(run(`${ROOT}/src/components/A.tsx?v=123`)).toContain('data-galley-src="src/components/A.tsx:1:24"');
  });

  it('only handles .jsx and .tsx outside node_modules', () => {
    const { run } = setup();
    expect(run(`${ROOT}/src/A.jsx`)).toContain('data-galley-src="src/A.jsx:1:24"');
    expect(run(`${ROOT}/src/a.ts`)).toBeNull();
    expect(run(`${ROOT}/src/a.css`, 'div {}')).toBeNull();
    expect(run(`${ROOT}/node_modules/lib/A.tsx`)).toBeNull();
    expect(run('\0virtual:A.tsx')).toBeNull();
  });

  it('honours include and exclude', () => {
    const { run } = setup({ include: 'src/**', exclude: /legacy/ });
    expect(run(`${ROOT}/src/A.tsx`)).not.toBeNull();
    expect(run(`${ROOT}/other/A.tsx`)).toBeNull();
    expect(run(`${ROOT}/src/legacy/A.tsx`)).toBeNull();
  });
});
