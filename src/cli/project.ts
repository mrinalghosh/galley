// The per-project .galley/ folder: created on start, read by the other commands
// (done, fail, listen) to find the running server and its token.
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '../shared/constants.js';

/** Written to .galley/server.json while a server runs, so other commands can find it. */
export interface ServerInfo {
  port: number;
  target: string;
  pid: number;
  startedAt: string;
}

export function dataDirOf(cwd: string): string {
  return join(cwd, DATA_DIR);
}

/** Creates .galley/ with a .gitignore that ignores everything in it. */
export async function ensureDataDir(cwd: string): Promise<string> {
  const dir = dataDirOf(cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'EEXIST') throw err;
  });
  return dir;
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Writes the token readable by the owner only. chmod covers a token file left by an earlier run. */
export async function writeToken(dataDir: string, token: string): Promise<void> {
  const file = join(dataDir, 'token');
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}

export async function readToken(dataDir: string): Promise<string> {
  return (await readFile(join(dataDir, 'token'), 'utf8')).trim();
}

export async function writeServerInfo(dataDir: string, info: ServerInfo): Promise<void> {
  await writeFile(join(dataDir, 'server.json'), `${JSON.stringify(info, null, 2)}\n`);
}

export async function readServerInfo(dataDir: string): Promise<ServerInfo | undefined> {
  try {
    return JSON.parse(await readFile(join(dataDir, 'server.json'), 'utf8')) as ServerInfo;
  } catch {
    return undefined;
  }
}

export async function removeServerInfo(dataDir: string): Promise<void> {
  await rm(join(dataDir, 'server.json'), { force: true });
}
