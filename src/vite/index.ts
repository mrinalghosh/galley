import path from 'node:path';
import { createFilter, type FilterPattern, type Plugin } from 'vite';
import { addSourceAttributes } from './transform.js';

export interface GalleyViteOptions {
  /** Narrows which .jsx/.tsx files are tagged. Globs or regexes, resolved against the Vite root. Default: all of them. */
  include?: FilterPattern;
  /** Files to leave alone. node_modules is always excluded. */
  exclude?: FilterPattern;
}

const JSX_FILE = /\.[jt]sx$/;

/**
 * Tags every host JSX element with `data-galley-src="<file>:<line>:<col>"` during `vite serve`,
 * so galley's picker can report where an element is rendered. Builds are untouched.
 */
export default function galley(options: GalleyViteOptions = {}): Plugin {
  let root = process.cwd();
  let isIncluded = createFilter(options.include, options.exclude);

  return {
    name: 'galley',
    apply: 'serve',
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
      isIncluded = createFilter(options.include, options.exclude, { resolve: root });
    },

    transform(code, id) {
      const file = id.split('?', 1)[0]!;
      if (id.startsWith('\0') || !JSX_FILE.test(file) || file.includes('/node_modules/')) return null;
      if (!isIncluded(file)) return null;

      const relative = path.relative(root, file).split(path.sep).join('/');
      return addSourceAttributes(code, file, relative);
    },
  };
}
