// Reverse proxy to the target dev server, HTTP and WebSocket. HTML documents
// are buffered so the overlay can be injected; everything else streams through.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex, Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { createProxyServer } from 'http-proxy-3';
import type { GalleyContext } from './types.js';
import { allowedHosts, tokenSetCookie } from './security.js';
import { appendSetCookie, isHtml, rewriteRequestHeaders, rewriteResponseHeaders } from './headers.js';
import { injectOverlayBytes } from './inject.js';

export interface Proxy {
  web(req: IncomingMessage, res: ServerResponse): void;
  ws(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): void;
}

export function createProxy(ctx: GalleyContext): Proxy {
  const proxy = createProxyServer({
    target: ctx.target,
    changeOrigin: true,
    selfHandleResponse: true,
    // Self-signed certs are the norm for local https dev servers.
    secure: false,
  });
  const proxyOrigins = allowedHosts(ctx.port).map((host) => `http://${host}`);

  proxy.on('proxyRes', (proxyRes, req, res) => {
    const headers = rewriteResponseHeaders(proxyRes.headers, { target: ctx.target });
    const status = proxyRes.statusCode ?? 502;
    const decoder = decoderFor(proxyRes.headers['content-encoding']);
    if (!hasBody(req, status) || !isHtml(proxyRes.headers) || decoder === null) {
      res.writeHead(status, proxyRes.statusMessage, headers);
      proxyRes.pipe(res);
      return;
    }
    readBody(proxyRes, decoder)
      .then((body) => {
        const injected = injectOverlayBytes(body);
        delete headers['content-encoding'];
        delete headers.etag;
        delete headers['last-modified'];
        headers['content-length'] = injected.length;
        headers['cache-control'] = 'no-store';
        // Lets the overlay call the API when the site is opened without the shell.
        appendSetCookie(headers, tokenSetCookie(ctx.port, ctx.token));
        res.writeHead(status, proxyRes.statusMessage, headers);
        res.end(injected);
      })
      .catch((err: Error) => sendUnreachable(res, ctx.target, err));
  });

  proxy.on('error', (err, _req, resOrSocket) => {
    if ('writeHead' in resOrSocket) sendUnreachable(resOrSocket, ctx.target, err);
    else resOrSocket.destroy();
  });

  const rewrite = (req: IncomingMessage) => {
    req.headers = rewriteRequestHeaders(req.headers, { proxyOrigins, target: ctx.target });
  };

  return {
    web(req, res) {
      rewrite(req);
      proxy.web(req, res);
    },
    ws(req, socket, head) {
      rewrite(req);
      socket.on('error', () => socket.destroy());
      proxy.ws(req, socket, head);
    },
    close() {
      proxy.close();
    },
  };
}

function hasBody(req: IncomingMessage, status: number): boolean {
  return req.method !== 'HEAD' && status !== 204 && status !== 304 && status >= 200;
}

type Decoder = Transform | 'identity';

/** How to decompress a body the target sent despite `accept-encoding: identity`. Null when we can't. */
function decoderFor(contentEncoding: string | undefined): Decoder | null {
  const encoding = (contentEncoding ?? 'identity').toLowerCase().trim();
  if (encoding === 'identity') return 'identity';
  if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip();
  if (encoding === 'deflate') return createInflate();
  if (encoding === 'br') return createBrotliDecompress();
  return null;
}

function readBody(res: IncomingMessage, decoder: Decoder): Promise<Buffer> {
  const stream = decoder === 'identity' ? res : res.pipe(decoder);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    res.on('error', reject);
  });
}

/** 502 page that retries on its own, so starting the dev server after galley just works. */
function sendUnreachable(res: ServerResponse, target: URL, err: Error): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const message = escapeHtml(`${target.origin}: ${err.message}`);
  res.writeHead(502, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2">` +
      `<title>galley: target unreachable</title>` +
      `<body style="font:14px system-ui;padding:2rem;color:#444">` +
      `<p><strong>galley can't reach the dev server.</strong> Retrying every 2 seconds.</p>` +
      `<pre>${message}</pre></body>`,
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
