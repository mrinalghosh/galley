// Header rewrites between the browser and the target. Pure, so they're unit-tested.
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import { stripGalleyCookies } from './security.js';

/** Connection-scoped headers that must not be copied from one hop to the next. */
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];

/** True when the browser is asking for a document, so the response may be HTML we inject into. */
export function wantsDocument(headers: IncomingHttpHeaders): boolean {
  const dest = headers['sec-fetch-dest'];
  if (dest === 'document' || dest === 'iframe') return true;
  return (headers.accept ?? '').includes('text/html');
}

export interface RequestRewrite {
  /** The proxy's own origin, e.g. http://localhost:5300. */
  proxyOrigins: string[];
  target: URL;
}

/**
 * Headers forwarded to the target: galley cookies removed; an Origin that is
 * ours rewritten to the target's (the Host header is rewritten too, so servers
 * that compare the two, like Next's server actions, stay happy); documents
 * requested uncompressed and unconditionally, so every HTML response has a
 * body to inject into and a fresh token cookie.
 */
export function rewriteRequestHeaders(headers: IncomingHttpHeaders, rewrite: RequestRewrite): IncomingHttpHeaders {
  const out: IncomingHttpHeaders = { ...headers };

  const cookie = stripGalleyCookies(headers.cookie);
  if (cookie === undefined) delete out.cookie;
  else out.cookie = cookie;

  if (headers.origin && rewrite.proxyOrigins.includes(headers.origin.toLowerCase())) {
    out.origin = rewrite.target.origin;
  }

  if (wantsDocument(headers)) {
    out['accept-encoding'] = 'identity';
    delete out['if-none-match'];
    delete out['if-modified-since'];
  }
  return out;
}

/** Removes `frame-ancestors` from a CSP value. Undefined when no directives are left. */
export function stripFrameAncestors(csp: string): string | undefined {
  const policies = csp
    .split(',')
    .map((policy) =>
      policy
        .split(';')
        .map((directive) => directive.trim())
        .filter((directive) => directive && !/^frame-ancestors(\s|$)/i.test(directive))
        .join('; '),
    )
    .filter(Boolean);
  return policies.length ? policies.join(', ') : undefined;
}

export interface ResponseRewrite {
  target: URL;
}

/**
 * Headers sent back to the browser: hop-by-hop headers dropped, framing
 * restrictions removed so the shell can frame the site, and redirects to the
 * target's own origin made relative so they stay on the proxy.
 */
export function rewriteResponseHeaders(headers: IncomingHttpHeaders, rewrite: ResponseRewrite): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.includes(name)) continue;
    out[name] = value;
  }
  delete out['x-frame-options'];

  const csp = headers['content-security-policy'];
  if (csp) {
    const stripped = stripFrameAncestors(Array.isArray(csp) ? csp.join(', ') : csp);
    if (stripped) out['content-security-policy'] = stripped;
    else delete out['content-security-policy'];
  }

  const location = headers.location;
  if (typeof location === 'string') out.location = relativeToTarget(location, rewrite.target);
  return out;
}

function relativeToTarget(location: string, target: URL): string {
  try {
    const url = new URL(location);
    if (url.origin !== target.origin) return location;
    return url.pathname + url.search + url.hash;
  } catch {
    return location;
  }
}

export function isHtml(headers: IncomingHttpHeaders): boolean {
  return /^\s*text\/html\b/i.test(headers['content-type'] ?? '');
}

/** Appends a Set-Cookie value without dropping the target's own cookies. */
export function appendSetCookie(headers: OutgoingHttpHeaders, cookie: string): void {
  const existing = headers['set-cookie'];
  if (existing === undefined) headers['set-cookie'] = [cookie];
  else if (Array.isArray(existing)) headers['set-cookie'] = [...existing, cookie];
  else headers['set-cookie'] = [String(existing), cookie];
}
