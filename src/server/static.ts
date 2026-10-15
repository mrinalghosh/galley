// The shell page and the browser bundles built by scripts/build.mjs.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { PREFIX } from '../shared/constants.js';
import type { GalleyContext } from './types.js';
import { tokenSetCookie } from './security.js';

export const BUNDLES: Record<string, string> = {
  '/overlay.js': 'overlay.js',
  '/shell.js': 'shell.js',
};

/** Config the shell reads from the page, in a JSON script tag. */
export interface ShellConfig {
  target: string;
  port: number;
  cwd: string;
}

export function shellHtml(config: ShellConfig): string {
  // Escaping `<` keeps the JSON from closing the script tag.
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>galley</title>
<link rel="icon" href="data:,">
<script type="application/json" id="galley-config">${json}</script>
</head>
<body>
<div id="galley-shell"></div>
<script src="${PREFIX}/shell.js"></script>
</body>
</html>
`;
}

export function sendShell(res: ServerResponse, ctx: GalleyContext, headOnly: boolean): void {
  const body = shellHtml({ target: ctx.target.href, port: ctx.port, cwd: ctx.cwd });
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'set-cookie': tokenSetCookie(ctx.port, ctx.token),
    // The shell will host a terminal: nothing may frame it.
    'x-frame-options': 'DENY',
    'content-security-policy': "frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
  });
  res.end(headOnly ? undefined : body);
}

/** Serves a bundle, read on every request so `npm run dev` rebuilds show up on reload. */
export async function sendBundle(res: ServerResponse, clientDir: string, file: string, headOnly: boolean): Promise<void> {
  let body: Buffer;
  try {
    body = await readFile(join(clientDir, file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`galley: ${file} not built. Run \`npm run build\` in the galley package.\n`);
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  res.end(headOnly ? undefined : body);
}
