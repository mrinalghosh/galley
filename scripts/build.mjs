// Builds the CLI and Vite plugin for Node, and the shell and overlay for the browser.
// `--watch` rebuilds on change.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const node = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
};

const browser = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  sourcemap: 'inline',
  logLevel: 'info',
  loader: { '.css': 'text' },
};

const builds = [
  { ...node, entryPoints: ['src/cli/index.ts'], outfile: 'dist/cli.js' },
  { ...node, entryPoints: ['src/vite/index.ts'], outfile: 'dist/vite/index.js' },
  { ...browser, entryPoints: ['src/overlay/index.tsx'], outfile: 'dist/client/overlay.js' },
  { ...browser, entryPoints: ['src/shell/index.tsx'], outfile: 'dist/client/shell.js' },
];

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}

// Type declarations for the `galley/vite` export (package.json "exports./vite.types" -> dist/vite/index.d.ts).
{
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const tsc = fileURLToPath(new URL('bin/tsc', import.meta.resolve('typescript/package.json')));
  const project = fileURLToPath(new URL('../src/vite/tsconfig.types.json', import.meta.url));
  execFileSync(process.execPath, [tsc, '-p', project], { stdio: 'inherit' });
}
