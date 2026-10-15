// How a chat should invoke galley in the done/fail commands of a prompt. The
// chat may run in any directory and may not have galley on its PATH, so this
// is resolved once at startup: plain `galley` when it's on PATH, otherwise
// `node <abs path to bin/galley.js>`.
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellQuote } from './prompt.js';

export function resolveCliCommand(env: NodeJS.ProcessEnv = process.env, binPath: string | undefined = findBinPath()): string {
  if (findOnPath('galley', env.PATH ?? '')) return 'galley';
  if (!binPath) return 'galley';
  return `node ${shellQuote(binPath)}`;
}

/** Absolute path of an executable named `name` in PATH, if any. */
export function findOnPath(name: string, pathEnv: string): string | undefined {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here; keep looking.
    }
  }
  return undefined;
}

/**
 * bin/galley.js of this package. Walks up from this file so it works both from
 * the bundle (dist/cli.js) and from source under tests (src/server/delivery/).
 */
export function findBinPath(from: string = dirname(fileURLToPath(import.meta.url))): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && isGalleyPackage(pkg)) {
      const bin = join(dir, 'bin', 'galley.js');
      return existsSync(bin) ? bin : undefined;
    }
    if (dirname(dir) === dir) return undefined;
  }
}

function isGalleyPackage(file: string): boolean {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { name?: string }).name === 'galley';
  } catch {
    return false;
  }
}
