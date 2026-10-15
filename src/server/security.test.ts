import { describe, expect, it } from 'vitest';
import {
  checkRequest,
  extractToken,
  galleyPath,
  isAllowedHost,
  isAllowedOrigin,
  stripGalleyCookies,
  tokenCookieName,
  tokenSetCookie,
  tokensMatch,
  type CheckInput,
} from './security.js';

const config = { port: 5300, token: 'secret-token' };

function input(overrides: Partial<CheckInput> & { headers?: CheckInput['headers'] } = {}): CheckInput {
  return {
    method: 'GET',
    url: '/',
    upgrade: false,
    ...overrides,
    headers: { host: 'localhost:5300', ...overrides.headers },
  };
}

describe('host check', () => {
  it('allows localhost and 127.0.0.1 on our port only', () => {
    expect(isAllowedHost('localhost:5300', 5300)).toBe(true);
    expect(isAllowedHost('127.0.0.1:5300', 5300)).toBe(true);
    expect(isAllowedHost('LOCALHOST:5300', 5300)).toBe(true);
    expect(isAllowedHost('localhost:5301', 5300)).toBe(false);
    expect(isAllowedHost('localhost', 5300)).toBe(false);
    expect(isAllowedHost('evil.com:5300', 5300)).toBe(false);
    expect(isAllowedHost('localhost.evil.com:5300', 5300)).toBe(false);
    expect(isAllowedHost(undefined, 5300)).toBe(false);
  });

  it('refuses a foreign Host on proxied and galley requests alike', () => {
    const foreign = input({ headers: { host: 'rebind.evil.com:5300' } });
    expect(checkRequest(foreign, null, config)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest(foreign, '/', config)).toMatchObject({ ok: false, status: 403 });
  });
});

describe('origin check', () => {
  it('matches only our own http origins', () => {
    expect(isAllowedOrigin('http://localhost:5300', 5300)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5300', 5300)).toBe(true);
    expect(isAllowedOrigin('https://localhost:5300', 5300)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5202', 5300)).toBe(false);
    expect(isAllowedOrigin('null', 5300)).toBe(false);
  });

  it('refuses non-GET requests with a foreign Origin', () => {
    const post = input({ method: 'POST', headers: { origin: 'http://evil.com' } });
    expect(checkRequest(post, null, config)).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses WebSocket upgrades with a foreign Origin, even to the target', () => {
    const ws = input({ upgrade: true, headers: { origin: 'http://localhost:5202' } });
    expect(checkRequest(ws, null, config)).toMatchObject({ ok: false, status: 403 });
  });

  it('allows a GET with a foreign Origin (e.g. a cross-origin font load)', () => {
    expect(checkRequest(input({ headers: { origin: 'http://evil.com' } }), null, config).ok).toBe(true);
  });

  it('allows our own Origin and a missing Origin', () => {
    const own = input({ method: 'POST', headers: { origin: 'http://localhost:5300' } });
    expect(checkRequest(own, null, config).ok).toBe(true);
    expect(checkRequest(input({ method: 'POST' }), null, config).ok).toBe(true);
  });
});

describe('token check', () => {
  const cookie = `${tokenCookieName(5300)}=secret-token`;

  it('serves the shell page and bundles without a token', () => {
    for (const path of ['', '/', '/overlay.js', '/shell.js']) {
      expect(checkRequest(input(), path, config).ok).toBe(true);
    }
  });

  it('refuses other galley paths without a token', () => {
    expect(checkRequest(input(), '/comments', config)).toMatchObject({ ok: false, status: 401 });
    expect(checkRequest(input({ method: 'POST' }), '/', config)).toMatchObject({ ok: false, status: 401 });
  });

  it('always requires a token on galley WebSocket upgrades', () => {
    expect(checkRequest(input({ upgrade: true }), '/', config).ok).toBe(false);
    expect(checkRequest(input({ upgrade: true, headers: { cookie } }), '/events', config).ok).toBe(true);
  });

  it('accepts the token as cookie, query param or bearer header', () => {
    expect(checkRequest(input({ headers: { cookie } }), '/comments', config).ok).toBe(true);
    expect(checkRequest(input({ url: '/__galley/listen?name=a&token=secret-token' }), '/listen', config).ok).toBe(true);
    expect(checkRequest(input({ headers: { authorization: 'Bearer secret-token' } }), '/comments', config).ok).toBe(true);
  });

  it('refuses a wrong token, and a cookie meant for another port', () => {
    expect(checkRequest(input({ url: '/x?token=nope' }), '/x', config).ok).toBe(false);
    const otherPort = input({ headers: { cookie: `${tokenCookieName(5310)}=secret-token` } });
    expect(checkRequest(otherPort, '/x', config).ok).toBe(false);
  });

  it('does not need a token for proxied requests', () => {
    expect(checkRequest(input({ method: 'POST' }), null, config).ok).toBe(true);
  });

  it('compares tokens safely', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abcd', 'abc')).toBe(false);
    expect(tokensMatch(undefined, 'abc')).toBe(false);
    expect(tokensMatch('', 'abc')).toBe(false);
  });

  it('prefers the cookie over other sources', () => {
    const headers = { cookie: `${tokenCookieName(5300)}=from-cookie`, authorization: 'Bearer from-header' };
    expect(extractToken(headers, '/?token=from-query', 5300)).toBe('from-cookie');
    expect(extractToken({ authorization: 'Bearer from-header' }, '/', 5300)).toBe('from-header');
  });
});

describe('paths and cookies', () => {
  it('classifies galley paths after normalising dot segments', () => {
    expect(galleyPath('/__galley')).toBe('');
    expect(galleyPath('/__galley/')).toBe('/');
    expect(galleyPath('/__galley/comments?x=1')).toBe('/comments');
    expect(galleyPath('/app/../__galley/comments')).toBe('/comments');
    expect(galleyPath('/__galleyish')).toBeNull();
    expect(galleyPath('/')).toBeNull();
    expect(galleyPath('/src/main.tsx')).toBeNull();
  });

  it('sets an HttpOnly, SameSite=Strict cookie scoped to the prefix', () => {
    expect(tokenSetCookie(5300, 't')).toBe('galley_token_5300=t; Path=/__galley; HttpOnly; SameSite=Strict');
  });

  it('strips every galley cookie before forwarding and keeps the rest', () => {
    expect(stripGalleyCookies('a=1; galley_token_5300=x; galley_token=y; b=2')).toBe('a=1; b=2');
    expect(stripGalleyCookies('galley_token_5300=x')).toBeUndefined();
    expect(stripGalleyCookies(undefined)).toBeUndefined();
    expect(stripGalleyCookies('galley_tokenish=1')).toBe('galley_tokenish=1');
  });
});
