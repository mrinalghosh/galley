// End-to-end tests of the server against a fake target, over real sockets.
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createGalleyServer, type GalleyServer } from './index.js';
import { OVERLAY_TAG } from './inject.js';
import { tokenCookieName } from './security.js';
import type { GalleyContext, GalleyModule } from './types.js';

const PORT = 5309;
const TARGET_PORT = 5308;
const TOKEN = 'test-token';
const base = `http://localhost:${PORT}`;
const cookie = `${tokenCookieName(PORT)}=${TOKEN}`;

const HTML = '<!doctype html><html><head><title>t</title></head><body>hello</body></html>';
const seen: { url: string; headers: IncomingHttpHeaders }[] = [];

let target: Server;
let targetWs: WebSocketServer;
let galley: GalleyServer;

function startTarget(): Promise<void> {
  target = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    if (req.url === '/chunked') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'set-cookie': 'sid=1' });
      res.write(HTML.slice(0, 20));
      setTimeout(() => res.end(HTML.slice(20)), 10);
    } else if (req.url === '/gzip') {
      // A target that ignores accept-encoding: identity.
      const body = gzipSync(HTML);
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', 'content-length': body.length });
      res.end(body);
    } else if (req.url === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'content-length': 9 });
      res.end('let a = 1');
    } else {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(HTML) });
      res.end(HTML);
    }
  });
  targetWs = new WebSocketServer({ server: target });
  targetWs.on('connection', (socket, req) => socket.send(`target:${req.url}:${req.headers.origin}`));
  return new Promise((resolve) => target.listen(TARGET_PORT, '127.0.0.1', resolve));
}

const echoModule: GalleyModule = {
  name: 'echo',
  http(req, res, path) {
    if (path !== '/echo') return false;
    res.end(`echo ${req.method}`);
    return true;
  },
  upgrade(req, socket, head, path) {
    if (path !== '/echo-ws') return false;
    const wss = new WebSocketServer({ noServer: true });
    wss.handleUpgrade(req, socket, head, (ws) => ws.send('module-ws'));
    return true;
  },
};

beforeAll(async () => {
  await startTarget();
  const cwd = await mkdtemp(join(tmpdir(), 'galley-test-'));
  const clientDir = join(cwd, 'client');
  await mkdir(clientDir);
  await writeFile(join(clientDir, 'overlay.js'), '/* overlay */');
  const ctx: GalleyContext = {
    cwd,
    dataDir: join(cwd, '.galley'),
    port: PORT,
    target: new URL(`http://127.0.0.1:${TARGET_PORT}`),
    token: TOKEN,
    agent: 'claude',
  };
  galley = createGalleyServer({ ctx, modules: [echoModule], clientDir });
  await galley.listen();
});

afterAll(async () => {
  await galley.close();
  targetWs.close();
  await new Promise((resolve) => target.close(resolve));
});

/** Raw request, so tests can send any Host header. */
function raw(path: string, headers: Record<string, string>, method = 'GET'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function openWs(path: string, origin: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}${path}`, { origin, headers });
    ws.on('message', (data) => {
      resolve(String(data));
      ws.close();
    });
    ws.on('unexpected-response', (_req, res) => resolve(`status ${res.statusCode}`));
    ws.on('error', () => undefined);
  });
}

describe('proxying HTML', () => {
  it('injects the overlay into a chunked response and fixes content-length', async () => {
    const res = await fetch(`${base}/chunked`, { headers: { accept: 'text/html' } });
    const body = await res.text();
    expect(body).toContain(`${OVERLAY_TAG}</head>`);
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(body)));
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.getSetCookie()).toEqual(['sid=1', expect.stringContaining(`${cookie};`)]);
    expect(seen.at(-1)?.headers['accept-encoding']).toBe('identity');
  });

  it('decompresses HTML the target gzipped anyway', async () => {
    const res = await fetch(`${base}/gzip`, { headers: { accept: 'text/html' } });
    expect(await res.text()).toContain(OVERLAY_TAG);
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  it('streams other responses untouched', async () => {
    const res = await fetch(`${base}/app.js`);
    expect(await res.text()).toBe('let a = 1');
  });

  it('strips galley cookies before forwarding', async () => {
    await fetch(`${base}/app.js`, { headers: { cookie: `a=1; ${cookie}` } });
    expect(seen.at(-1)?.headers.cookie).toBe('a=1');
  });
});

describe('galley routes', () => {
  it('serves the shell page with the token cookie, and bundles without a token', async () => {
    const shell = await fetch(`${base}/__galley/`);
    expect(shell.status).toBe(200);
    expect(shell.headers.get('set-cookie')).toContain(`${cookie};`);
    expect(await shell.text()).toContain('/__galley/shell.js');
    expect(await (await fetch(`${base}/__galley/overlay.js`)).text()).toBe('/* overlay */');
  });

  it('dispatches to modules only with the token, and never to the target', async () => {
    const before = seen.length;
    expect((await fetch(`${base}/__galley/echo`)).status).toBe(401);
    const ok = await fetch(`${base}/__galley/echo`, { method: 'POST', headers: { cookie } });
    expect(await ok.text()).toBe('echo POST');
    expect((await fetch(`${base}/__galley/missing?token=${TOKEN}`)).status).toBe(404);
    expect(seen.length).toBe(before);
  });

  it('refuses a foreign Host', async () => {
    expect((await raw('/', { host: 'evil.test' })).status).toBe(403);
    expect((await raw('/__galley/', { host: `evil.test:${PORT}` })).status).toBe(403);
  });

  it('refuses a POST with a foreign Origin', async () => {
    expect((await raw('/', { host: `localhost:${PORT}`, origin: 'http://evil.test' }, 'POST')).status).toBe(403);
  });
});

describe('websockets', () => {
  it('proxies upgrades to the target with our Origin rewritten to its own', async () => {
    expect(await openWs('/hmr', base)).toBe(`target:/hmr:http://127.0.0.1:${TARGET_PORT}`);
  });

  it('refuses upgrades with a foreign Origin', async () => {
    expect(await openWs('/hmr', 'http://evil.test')).toBe('status 403');
  });

  it('routes galley upgrades to modules, token required', async () => {
    expect(await openWs('/__galley/echo-ws', base)).toBe('status 401');
    expect(await openWs('/__galley/echo-ws', base, { cookie })).toBe('module-ws');
    expect(await openWs(`/__galley/nothing?token=${TOKEN}`, base)).toBe('status 404');
  });
});
