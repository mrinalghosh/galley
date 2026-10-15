import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findBinPath, findOnPath, resolveCliCommand } from './cli.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'galley-cli-'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('resolveCliCommand', () => {
  it('uses plain `galley` when it is on PATH', () => {
    const bin = join(dir, 'galley');
    writeFileSync(bin, '#!/bin/sh\n');
    chmodSync(bin, 0o755);
    expect(findOnPath('galley', `/nonexistent:${dir}`)).toBe(bin);
    expect(resolveCliCommand({ PATH: dir }, '/pkg/bin/galley.js')).toBe('galley');
  });

  it('falls back to node <abs bin path>, quoted when needed', () => {
    expect(resolveCliCommand({ PATH: dir }, '/pkg/bin/galley.js')).toBe('node /pkg/bin/galley.js');
    expect(resolveCliCommand({ PATH: '' }, '/my pkg/bin/galley.js')).toBe(`node '/my pkg/bin/galley.js'`);
  });

  it('ignores a non-executable file named galley', () => {
    writeFileSync(join(dir, 'galley'), '');
    expect(findOnPath('galley', dir)).toBeUndefined();
  });

  it('finds this package’s bin/galley.js from source', () => {
    expect(findBinPath()).toMatch(/\/bin\/galley\.js$/);
  });
});
