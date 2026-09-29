// Loads node-pty, an optional native dependency. When it's missing or broken,
// galley keeps running with the terminal disabled.
import { accessSync, chmodSync, constants, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** The slice of node-pty's IPty that galley uses. */
export interface PtyProcess {
  readonly pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface SpawnOptions {
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export type Spawn = (file: string, args: string[], options: SpawnOptions) => PtyProcess;

export type PtyLoad = { ok: true; spawn: Spawn } | { ok: false; message: string };

interface NodePty {
  spawn(file: string, args: string[], options: SpawnOptions & { name: string }): PtyProcess;
}

const PACKAGE = 'node-pty';

let loading: Promise<PtyLoad> | undefined;

/** Imports node-pty once and prepares its spawn helper. Never throws. */
export function loadPty(): Promise<PtyLoad> {
  loading ??= load();
  return loading;
}

async function load(): Promise<PtyLoad> {
  let pty: NodePty;
  try {
    // A variable specifier keeps bundlers and tsc from requiring the optional package.
    const specifier: string = PACKAGE;
    const loaded = (await import(specifier)) as NodePty & { default?: NodePty };
    pty = typeof loaded.spawn === 'function' ? loaded : loaded.default!;
    if (typeof pty?.spawn !== 'function') throw new Error('node-pty has no spawn()');
  } catch (error) {
    return {
      ok: false,
      message: `node-pty could not be loaded (${firstLine(error)}). Reinstall galley's dependencies (npm install) on a supported Node version to enable the terminal.`,
    };
  }
  try {
    ensureSpawnHelperExecutable();
  } catch (error) {
    return { ok: false, message: `node-pty's spawn-helper is not executable and could not be fixed (${firstLine(error)}).` };
  }
  return { ok: true, spawn: (file, args, options) => pty.spawn(file, args, { name: 'xterm-256color', ...options }) };
}

/**
 * npm can drop the execute bit from node-pty's prebuilt `spawn-helper`
 * (seen with node-pty 1.1.0), and every spawn then fails with
 * "posix_spawnp failed". Restore it before the first spawn.
 */
export function ensureSpawnHelperExecutable(packageDir = findPackageDir()): string[] {
  if (process.platform === 'win32' || !packageDir) return [];
  const fixed: string[] = [];
  for (const dir of ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`]) {
    const helper = join(packageDir, dir, 'spawn-helper');
    if (!existsSync(helper) || isExecutable(helper)) continue;
    chmodSync(helper, statSync(helper).mode | 0o111);
    fixed.push(helper);
  }
  return fixed;
}

function findPackageDir(): string | undefined {
  try {
    return dirname(createRequire(import.meta.url).resolve(`${PACKAGE}/package.json`));
  } catch {
    return undefined;
  }
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0] ?? text;
}
