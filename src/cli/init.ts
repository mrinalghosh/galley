// `galley init [--force]`: installs the /galley slash command into
// <claude config dir>/commands/galley.md. A file galley wrote carries a hash of
// its own text, so an older galley version is updated in place while a file the
// user edited is left alone unless --force.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { SLASH_COMMAND } from './slash-command.js';

const MARKER = /\n<!-- galley-managed sha256=([0-9a-f]{64}) -->\n?$/;

export type InitOutcome = 'installed' | 'unchanged' | 'updated' | 'replaced';

/** Honours CLAUDE_CONFIG_DIR, else ~/.claude (HOME-aware). */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude');
}

export function commandFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeConfigDir(env), 'commands', 'galley.md');
}

export function renderCommand(body: string = SLASH_COMMAND): string {
  return `${body}\n<!-- galley-managed sha256=${sha256(body)} -->\n`;
}

/** True when the file is exactly as some galley version wrote it. */
export function isUnmodified(text: string): boolean {
  const match = MARKER.exec(text);
  return !!match && sha256(text.slice(0, match.index)) === match[1];
}

export async function installCommand(file: string, force: boolean): Promise<InitOutcome> {
  const wanted = renderCommand();
  const existing = await readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  });
  if (existing === wanted) return 'unchanged';
  if (existing !== undefined && !isUnmodified(existing) && !force) {
    throw new Error(`${file} has been edited; rerun with --force to replace it`);
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, wanted);
  if (existing === undefined) return 'installed';
  return isUnmodified(existing) ? 'updated' : 'replaced';
}

const MESSAGES: Record<InitOutcome, string> = {
  installed: 'installed the /galley command',
  unchanged: '/galley command is already up to date',
  updated: 'updated the /galley command',
  replaced: 'replaced your edited /galley command (--force)',
};

export async function init(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { force: { type: 'boolean', default: false } } });
  const file = commandFile();
  const outcome = await installCommand(file, values.force);
  console.log(`galley: ${MESSAGES[outcome]} at ${file}`);
  if (outcome !== 'unchanged') console.log('galley: in any Claude Code chat, run /galley [name] to start listening');
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
