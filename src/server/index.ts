// The galley server: one node:http server on 127.0.0.1 that runs the security
// checks, serves PREFIX (shell, bundles, modules) and proxies everything else.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { PREFIX } from '../shared/constants.js';
import type { GalleyContext, GalleyModule } from './types.js';
import { checkRequest, galleyPath, type CheckInput, type Verdict } from './security.js';
import { createProxy } from './proxy.js';
import { BUNDLES, sendBundle, sendShell } from './static.js';

export const HOST = '127.0.0.1';

export interface GalleyServerOptions {
  ctx: GalleyContext;
  modules: GalleyModule[];
  /** Folder holding overlay.js and shell.js (dist/client). */
  clientDir: string;
}

export interface GalleyServer {
  server: Server;
  /** Runs each module's init, then listens on 127.0.0.1:ctx.port. */
  listen(): Promise<void>;
  /** Stops accepting connections, drops open ones and closes every module. */
  close(): Promise<void>;
}

export function createGalleyServer({ ctx, modules, clientDir }: GalleyServerOptions): GalleyServer {
  const proxy = createProxy(ctx);
  const config = { port: ctx.port, token: ctx.token };

  const verdictFor = (req: IncomingMessage, upgrade: boolean, path: string | null): Verdict => {
    const input: CheckInput = { method: req.method, url: req.url, headers: req.headers, upgrade };
    return checkRequest(input, path, config);
  };

  async function handleGalley(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const readOnly = req.method === 'GET' || req.method === 'HEAD';
    const headOnly = req.method === 'HEAD';
    if (path === '' && readOnly) {
      res.writeHead(302, { location: `${PREFIX}/` });
      res.end();
      return;
    }
    if (path === '/' && readOnly) return sendShell(res, ctx, headOnly);
    const bundle = BUNDLES[path];
    if (bundle && readOnly) return sendBundle(res, clientDir, bundle, headOnly);

    for (const module of modules) {
      if (module.http && (await module.http(req, res, path, ctx))) return;
    }
    sendText(res, 404, 'not found');
  }

  const server = createServer((req, res) => {
    const path = galleyPath(req.url);
    const verdict = verdictFor(req, false, path);
    if (!verdict.ok) return sendText(res, verdict.status, `galley: ${verdict.reason}`);
    if (path === null) return proxy.web(req, res);

    handleGalley(req, res, path).catch((err: unknown) => {
      console.error(`galley: ${req.method} ${req.url} failed:`, err);
      if (res.headersSent) res.destroy();
      else sendText(res, 500, 'internal error');
    });
  });

  // Upgraded sockets leave http's connection tracking; keep them so close() can end them.
  const upgraded = new Set<Duplex>();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    upgraded.add(socket);
    socket.on('close', () => upgraded.delete(socket));
    socket.on('error', () => socket.destroy());
    const path = galleyPath(req.url);
    const verdict = verdictFor(req, true, path);
    if (!verdict.ok) return rejectUpgrade(socket, verdict.status, verdict.reason);
    if (path === null) return proxy.ws(req, socket, head);

    try {
      for (const module of modules) {
        if (module.upgrade?.(req, socket, head, path, ctx)) return;
      }
    } catch (err) {
      console.error(`galley: upgrade ${req.url} failed:`, err);
      return rejectUpgrade(socket, 500, 'internal error');
    }
    rejectUpgrade(socket, 404, 'not found');
  });

  return {
    server,
    async listen() {
      for (const module of modules) await module.init?.(ctx);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(ctx.port, HOST, () => {
          server.off('error', reject);
          resolve();
        });
      });
    },
    async close() {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      for (const socket of upgraded) socket.destroy();
      proxy.close();
      await Promise.allSettled(modules.map((module) => module.close?.()));
      await closed;
    },
  };
}

function sendText(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
  res.end(`${message}\n`);
}

const STATUS_TEXT: Record<number, string> = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error' };

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  const body = `galley: ${reason}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n` +
      body,
  );
}
