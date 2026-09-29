// Request checks for everything the proxy serves. Pure functions of headers
// and config, so they can be unit-tested without a server.
//
// Policy (see the spec's Security section):
// - Host must be localhost:<port> or 127.0.0.1:<port> on every request (DNS rebinding).
// - WebSocket upgrades and non-GET/HEAD requests that carry an Origin must carry ours.
// - Every PREFIX call needs the session token, except the shell page and the
//   static bundles (overlay.js, shell.js). The bundles hold no secrets and the
//   overlay must load in pages opened without the shell, before any cookie exists.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { PREFIX, TOKEN_COOKIE, TOKEN_PARAM } from '../shared/constants.js';

export type Verdict = { ok: true } | { ok: false; status: 401 | 403; reason: string };

const OK: Verdict = { ok: true };
const LOOPBACK_NAMES = ['localhost', '127.0.0.1'];

/** Paths under PREFIX that are served without a token ('' redirects to the shell page). */
export const PUBLIC_PATHS = new Set(['', '/', '/overlay.js', '/shell.js']);

export function allowedHosts(port: number): string[] {
  return LOOPBACK_NAMES.map((name) => `${name}:${port}`);
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  return allowedHosts(port).includes(host.toLowerCase());
}

export function isAllowedOrigin(origin: string, port: number): boolean {
  return allowedHosts(port).some((host) => origin.toLowerCase() === `http://${host}`);
}

/**
 * Cookie name for this proxy. Cookies are shared across ports on the same
 * host, so the port is part of the name: two galley instances on different
 * ports must not overwrite each other's token.
 */
export function tokenCookieName(port: number): string {
  return `${TOKEN_COOKIE}_${port}`;
}

/** Set-Cookie value that hands the browser the session token. */
export function tokenSetCookie(port: number, token: string): string {
  return `${tokenCookieName(port)}=${token}; Path=${PREFIX}; HttpOnly; SameSite=Strict`;
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name && !cookies.has(name)) cookies.set(name, part.slice(eq + 1).trim());
  }
  return cookies;
}

/** Removes every galley token cookie (any port) from a Cookie header. Undefined when nothing is left. */
export function stripGalleyCookies(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const kept = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${TOKEN_COOKIE}=`) && !part.startsWith(`${TOKEN_COOKIE}_`));
  return kept.length ? kept.join('; ') : undefined;
}

/** The token a request carries: cookie, then `?token=`, then `Authorization: Bearer`. */
export function extractToken(headers: IncomingHttpHeaders, url: string | undefined, port: number): string | undefined {
  const fromCookie = parseCookies(headers.cookie).get(tokenCookieName(port));
  if (fromCookie) return fromCookie;
  const fromQuery = new URL(url ?? '/', 'http://galley.invalid').searchParams.get(TOKEN_PARAM);
  if (fromQuery) return fromQuery;
  const auth = headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim() || undefined;
  return undefined;
}

export function tokensMatch(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pathname with dot segments resolved, so `/x/../__galley` can't dodge classification. */
export function normalizePath(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://galley.invalid').pathname;
  } catch {
    return '/';
  }
}

/** The path after PREFIX ('' for PREFIX itself), or null when the request is for the target. */
export function galleyPath(url: string | undefined): string | null {
  const path = normalizePath(url);
  if (path === PREFIX) return '';
  if (path.startsWith(`${PREFIX}/`)) return path.slice(PREFIX.length);
  return null;
}

export interface CheckInput {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  /** True for WebSocket upgrades. */
  upgrade: boolean;
}

export interface CheckConfig {
  port: number;
  token: string;
}

/** Host and Origin checks. Apply to every request, proxied or not. */
export function checkHostAndOrigin(input: CheckInput, config: CheckConfig): Verdict {
  if (!isAllowedHost(input.headers.host, config.port)) {
    return { ok: false, status: 403, reason: 'host not allowed' };
  }
  const safeMethod = input.method === 'GET' || input.method === 'HEAD';
  const origin = input.headers.origin;
  if ((input.upgrade || !safeMethod) && origin !== undefined && !isAllowedOrigin(origin, config.port)) {
    return { ok: false, status: 403, reason: 'origin not allowed' };
  }
  return OK;
}

/** Token check for a PREFIX request. `path` is the part after PREFIX. */
export function checkToken(input: CheckInput, path: string, config: CheckConfig): Verdict {
  const safeMethod = input.method === 'GET' || input.method === 'HEAD';
  if (!input.upgrade && safeMethod && PUBLIC_PATHS.has(path)) return OK;
  if (tokensMatch(extractToken(input.headers, input.url, config.port), config.token)) return OK;
  return { ok: false, status: 401, reason: 'missing or invalid token' };
}

/** Every check for one request. `path` is galleyPath(url): null for proxied requests. */
export function checkRequest(input: CheckInput, path: string | null, config: CheckConfig): Verdict {
  const base = checkHostAndOrigin(input, config);
  if (!base.ok || path === null) return base;
  return checkToken(input, path, config);
}
