// galley init, always against a temp HOME / CLAUDE_CONFIG_DIR. Never the real ~/.claude.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeConfigDir, commandFile, init, installCommand, isUnmodified, renderCommand } from './init.js';
import { SLASH_COMMAND } from './slash-command.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'galley-home-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe('galley init', () => {
  it('uses CLAUDE_CONFIG_DIR, else HOME/.claude', () => {
    expect(claudeConfigDir({ HOME: '/h' })).toBe('/h/.claude');
    expect(claudeConfigDir({ HOME: '/h', CLAUDE_CONFIG_DIR: '/c' })).toBe('/c');
    expect(commandFile({ HOME: '/h' })).toBe('/h/.claude/commands/galley.md');
  });

  it('installs into the temp HOME and is idempotent', async () => {
    await init([]);
    const file = join(home, '.claude', 'commands', 'galley.md');
    expect(readFileSync(file, 'utf8')).toBe(renderCommand());
    expect(await installCommand(file, false)).toBe('unchanged');
  });

  it('honours CLAUDE_CONFIG_DIR', async () => {
    const config = join(home, 'custom');
    vi.stubEnv('CLAUDE_CONFIG_DIR', config);
    await init([]);
    expect(readFileSync(join(config, 'commands', 'galley.md'), 'utf8')).toContain('Monitor tool');
  });

  it('updates a file an older galley wrote', async () => {
    const file = commandFile();
    await installCommand(file, false);
    writeFileSync(file, renderCommand('old version of the command\n'));
    expect(await installCommand(file, false)).toBe('updated');
    expect(readFileSync(file, 'utf8')).toBe(renderCommand());
  });

  it('keeps a user-edited file unless --force', async () => {
    const file = commandFile();
    await installCommand(file, false);
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nMy own tweak.\n`);
    await expect(init([])).rejects.toThrow(/--force/);
    expect(readFileSync(file, 'utf8')).toContain('My own tweak.');
    await init(['--force']);
    expect(readFileSync(file, 'utf8')).toBe(renderCommand());
  });

  it('detects edits via the embedded hash', () => {
    expect(isUnmodified(renderCommand())).toBe(true);
    expect(isUnmodified(renderCommand().replace('Monitor', 'monitor'))).toBe(false);
    expect(isUnmodified('hand-written command')).toBe(false);
  });
});

describe('the /galley command text', () => {
  it('covers naming, the token, the Monitor ws source, handling, re-arming and the ready line', () => {
    expect(SLASH_COMMAND).toMatch(/^---\ndescription: /);
    expect(SLASH_COMMAND).toContain('$ARGUMENTS');
    expect(SLASH_COMMAND).toContain('.galley/server.json');
    expect(SLASH_COMMAND).toContain('.galley/token');
    expect(SLASH_COMMAND).toContain('ws://127.0.0.1:<port>/__galley/listen?name=<url-encoded name>&token=<token>');
    expect(SLASH_COMMAND).toContain('timeout_ms: 1800000');
    expect(SLASH_COMMAND).toMatch(/Done command/);
    expect(SLASH_COMMAND).toMatch(/start it again/);
    expect(SLASH_COMMAND).toMatch(/Listening for galley comments as/);
  });
});
