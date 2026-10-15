import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

/** Trusted server state, built once at startup and passed to every module. */
export interface GalleyContext {
  /** Project folder: where .galley/ lives and where agents run. Absolute. */
  cwd: string;
  /** Absolute path to <cwd>/.galley. */
  dataDir: string;
  /** Port the proxy listens on, on 127.0.0.1. */
  port: number;
  /** The site's own dev server. */
  target: URL;
  /** Random per-process session token. */
  token: string;
  /** Agent command for the browser terminal, e.g. "claude". */
  agent: string;
}

/**
 * A feature mounted under PREFIX. The server runs the security checks
 * (host, origin, token) before calling any module, so modules can trust the
 * request. `path` is the request path with PREFIX removed, e.g. "/comments".
 * Return true when the module handled the request.
 */
export interface GalleyModule {
  name: string;
  /** Called once at startup, before the server listens. */
  init?(ctx: GalleyContext): void | Promise<void>;
  http?(req: IncomingMessage, res: ServerResponse, path: string, ctx: GalleyContext): boolean | Promise<boolean>;
  upgrade?(req: IncomingMessage, socket: Duplex, head: Buffer, path: string, ctx: GalleyContext): boolean;
  /** Called on shutdown. */
  close?(): void | Promise<void>;
}
