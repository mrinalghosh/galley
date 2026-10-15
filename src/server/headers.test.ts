import { describe, expect, it } from 'vitest';
import { appendSetCookie, rewriteRequestHeaders, rewriteResponseHeaders, stripFrameAncestors, wantsDocument } from './headers.js';

const target = new URL('http://localhost:5202');
const proxyOrigins = ['http://localhost:5300', 'http://127.0.0.1:5300'];

describe('rewriteRequestHeaders', () => {
  it('strips galley cookies and keeps the site’s own', () => {
    const out = rewriteRequestHeaders({ cookie: 'sid=1; galley_token_5300=t' }, { proxyOrigins, target });
    expect(out.cookie).toBe('sid=1');
    expect('cookie' in rewriteRequestHeaders({ cookie: 'galley_token_5300=t' }, { proxyOrigins, target })).toBe(false);
  });

  it('rewrites our Origin to the target’s and leaves others alone', () => {
    expect(rewriteRequestHeaders({ origin: 'http://localhost:5300' }, { proxyOrigins, target }).origin).toBe('http://localhost:5202');
    expect(rewriteRequestHeaders({ origin: 'http://other.test' }, { proxyOrigins, target }).origin).toBe('http://other.test');
  });

  it('asks for documents uncompressed and unconditionally', () => {
    const out = rewriteRequestHeaders(
      { accept: 'text/html,*/*', 'accept-encoding': 'gzip, br', 'if-none-match': 'W/"1"', 'if-modified-since': 'x' },
      { proxyOrigins, target },
    );
    expect(out['accept-encoding']).toBe('identity');
    expect(out['if-none-match']).toBeUndefined();
    expect(out['if-modified-since']).toBeUndefined();
  });

  it('leaves compression alone for assets', () => {
    const out = rewriteRequestHeaders({ accept: '*/*', 'accept-encoding': 'gzip' }, { proxyOrigins, target });
    expect(out['accept-encoding']).toBe('gzip');
    expect(wantsDocument({ 'sec-fetch-dest': 'iframe' })).toBe(true);
  });
});

describe('rewriteResponseHeaders', () => {
  it('removes framing restrictions and hop-by-hop headers', () => {
    const out = rewriteResponseHeaders(
      {
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
        'transfer-encoding': 'chunked',
        connection: 'keep-alive',
        'content-type': 'text/html',
      },
      { target },
    );
    expect(out).toEqual({ 'content-security-policy': "default-src 'self'", 'content-type': 'text/html' });
  });

  it('drops a CSP that only held frame-ancestors', () => {
    expect(rewriteResponseHeaders({ 'content-security-policy': "frame-ancestors 'self'" }, { target })).toEqual({});
  });

  it('makes redirects to the target relative', () => {
    expect(rewriteResponseHeaders({ location: 'http://localhost:5202/login?x=1#h' }, { target }).location).toBe('/login?x=1#h');
    expect(rewriteResponseHeaders({ location: 'https://auth.example.com/' }, { target }).location).toBe('https://auth.example.com/');
    expect(rewriteResponseHeaders({ location: '/relative' }, { target }).location).toBe('/relative');
  });
});

describe('stripFrameAncestors', () => {
  it('handles several policies and odd spacing', () => {
    expect(stripFrameAncestors("frame-ancestors 'none' ; script-src 'self', frame-ancestors x; img-src *")).toBe(
      "script-src 'self', img-src *",
    );
    expect(stripFrameAncestors('FRAME-ANCESTORS *')).toBeUndefined();
  });
});

describe('appendSetCookie', () => {
  it('keeps the target’s cookies', () => {
    const headers: Record<string, string | string[] | number> = { 'set-cookie': ['a=1'] };
    appendSetCookie(headers, 'b=2');
    expect(headers['set-cookie']).toEqual(['a=1', 'b=2']);
    const empty: Record<string, string[]> = {};
    appendSetCookie(empty, 'c=3');
    expect(empty['set-cookie']).toEqual(['c=3']);
  });
});
