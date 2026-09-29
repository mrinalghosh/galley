// `galley <target-url>`: sets up .galley/, starts the proxy and serves the shell.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_PORT, PREFIX } from '../shared/constants.js';
import { createGalleyServer } from '../server/index.js';
import { modules } from '../server/modules.js';
import type { GalleyContext } from '../server/types.js';
import { ensureDataDir, newToken, removeServerInfo, writeServerInfo, writeToken } from './project.js';
import { openInBrowser } from './open.js';

export interface StartOptions {
  target: URL;
  port: number;
  cwd: string;
  agent: string;
  open: boolean;
}

export function parseStartArgs(args: string[]): StartOptions {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      port: { type: 'string', default: String(DEFAULT_PORT) },
      cwd: { type: 'string', default: '.' },
      agent: { type: 'string', default: 'claude' },
      open: { type: 'boolean', default: false },
    },
  });
  const [target, ...extra] = positionals;
  if (!target) throw new Error('missing <target-url>, e.g. `galley http://localhost:5173`');
  if (extra.length) throw new Error(`unexpected argument "${extra[0]}"`);

  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid --port "${values.port}"`);

  return { target: parseTarget(target), port, cwd: resolve(values.cwd), agent: values.agent, open: values.open };
}

/** Accepts a full URL, `localhost:5173`, or a bare port. */
export function parseTarget(input: string): URL {
  const withScheme = /^\d+$/.test(input) ? `http://localhost:${input}` : /^[a-z]+:\/\//i.test(input) ? input : `http://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`invalid target URL "${input}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`target must be http or https, got "${input}"`);
  return url;
}

export async function start(args: string[]): Promise<void> {
  const options = parseStartArgs(args);
  const dataDir = await ensureDataDir(options.cwd);
  const token = newToken();
  await writeToken(dataDir, token);

  const ctx: GalleyContext = {
    cwd: options.cwd,
    dataDir,
    port: options.port,
    target: options.target,
    token,
    agent: options.agent,
  };
  // dist/cli.js sits next to dist/client/.
  const clientDir = fileURLToPath(new URL('./client/', import.meta.url));
  const galley = createGalleyServer({ ctx, modules, clientDir });

  try {
    await galley.listen();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new Error(`port ${options.port} is in use; pick another with --port`);
    }
    throw err;
  }
  await writeServerInfo(dataDir, {
    port: options.port,
    target: options.target.href,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });

  const shellUrl = `http://localhost:${options.port}${PREFIX}/`;
  console.log(`galley: proxying ${options.target.origin}`);
  console.log(`galley: shell at ${shellUrl}`);
  if (options.open) openInBrowser(shellUrl);

  let stopping = false;
  const stop = async () => {
    if (stopping) process.exit(1); // second Ctrl-C: don't wait
    stopping = true;
    await galley.close();
    await removeServerInfo(dataDir);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
