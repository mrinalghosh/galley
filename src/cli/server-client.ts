// Finding and calling the running galley server from other commands (done,
// fail, listen). The server advertises itself in .galley/server.json and its
// token in .galley/token.
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { PREFIX } from '../shared/constants.js';
import { dataDirOf, readServerInfo, readToken, type ServerInfo } from './project.js';

export interface RunningServer {
  /** Project folder holding .galley/. */
  root: string;
  info: ServerInfo;
  token: string;
}

/** The nearest project at or above `from` with a live galley server. Throws a readable error otherwise. */
export async function findServer(from: string): Promise<RunningServer> {
  const start = resolve(from);
  const root = findProjectRoot(start);
  if (!root) {
    throw new Error(`no galley server running (no .galley/server.json in ${start} or above). Start one with \`galley <site-url>\` in the project.`);
  }
  const dataDir = dataDirOf(root);
  const info = await readServerInfo(dataDir);
  if (!info || !Number.isInteger(info.port)) throw new Error(`${join(dataDir, 'server.json')} is unreadable; restart galley`);
  if (!isAlive(info.pid)) throw new Error(`the galley server for ${root} is not running (stale .galley/server.json); restart galley`);
  return { root, info, token: await readToken(dataDir) };
}

export function findProjectRoot(from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dataDirOf(dir), 'server.json'))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

/** Calls PREFIX<path> on the running server with the token. */
export function callServer(server: RunningServer, method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolvePromise, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: server.info.port,
        method,
        path: PREFIX + path,
        headers: {
          authorization: `Bearer ${server.token}`,
          ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolvePromise({ status: res.statusCode ?? 0, body: parseJson(text) });
        });
        res.on('error', reject);
      },
    );
    req.on('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'ECONNREFUSED' ? new Error(`no galley server is listening on port ${server.info.port}; restart galley`) : err);
    });
    req.end(payload);
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

/** The `error` of a JSON error body, or the raw text. */
export function errorText(body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body) return String((body as { error: unknown }).error);
  return typeof body === 'string' && body ? body : 'unknown error';
}
