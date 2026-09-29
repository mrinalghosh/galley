import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { Comment, ServerEvent } from '../../shared/protocol.js';
import type { GalleyContext } from '../types.js';
import { sampleComment } from './fixtures.js';
import { type CommentsModule, createCommentsModule } from './index.js';
import { MAX_SMALL_BODY } from './routes.js';
import { TargetRegistry } from './targets.js';

const PREFIX = '/__galley';

let dir: string;
let registry: TargetRegistry;
let mod: CommentsModule;
let server: Server;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'galley-routes-'));
  registry = new TargetRegistry();
  mod = createCommentsModule(registry);
  const ctx = { cwd: dir, dataDir: join(dir, '.galley'), port: 0, target: new URL('http://localhost:1'), token: 't', agent: 'claude' } satisfies GalleyContext;
  await mod.init!(ctx);
  // Stand-in for M1's dispatcher: strip PREFIX and hand the rest to the module.
  server = createServer(async (req, res) => {
    const path = (req.url ?? '').slice(PREFIX.length);
    if (!(await mod.http!(req, res, path, ctx))) res.writeHead(404).end();
  });
  server.on('upgrade', (req, socket, head) => {
    if (!mod.upgrade!(req, socket, head, (req.url ?? '').slice(PREFIX.length), ctx)) socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${PREFIX}`;
});

afterEach(async () => {
  await mod.close!();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

function post(path: string, body?: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  return fetch(base + path, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function createComment(overrides = {}): Promise<Comment> {
  const res = await post('/comments', sampleComment(overrides));
  expect(res.status).toBe(201);
  return ((await res.json()) as { comment: Comment }).comment;
}

describe('validation', () => {
  it.each([
    ['missing text', { text: undefined }],
    ['blank text', { text: '   ' }],
    ['bad mode', { mode: 'drag' }],
    ['non-numeric rect', { region: { x: 'a', y: 0, w: 0, h: 0 } }],
    ['too many elements', { elements: Array(21).fill(sampleComment().elements[0]) }],
    ['element without selector', { elements: [{ ...sampleComment().elements[0], selector: '' }] }],
    ['empty target', { target: '' }],
    ['non-PNG screenshot', { screenshotDataUrl: 'data:text/html;base64,PGgxPg==' }],
  ])('rejects %s with 400', async (_name, overrides) => {
    const res = await post('/comments', { ...sampleComment(), ...overrides });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  });

  it('rejects bodies that are not JSON', async () => {
    expect((await post('/comments', 'text=hi', { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await fetch(`${base}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status).toBe(400);
  });

  it('caps the body size', async () => {
    const c = await createComment();
    const res = await post(`/comments/${c.id}/done`, { note: 'x'.repeat(MAX_SMALL_BODY + 1) });
    expect(res.status).toBe(413);
  });

  it('drops unknown fields', async () => {
    const c = await createComment({ evil: true } as object);
    expect(c).not.toHaveProperty('evil');
  });

  it('returns 404 for unknown comments and 405 for wrong methods', async () => {
    expect((await post('/comments/c_nope/done', { note: 'x' })).status).toBe(404);
    expect((await fetch(`${base}/comments/c_nope`, { method: 'DELETE' })).status).toBe(404);
    expect((await fetch(`${base}/targets`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/comments`, { method: 'PUT' })).status).toBe(405);
  });

  it('leaves other paths to other modules', async () => {
    expect((await fetch(`${base}/pty`)).status).toBe(404);
  });
});

describe('lifecycle', () => {
  it('queues when no target is connected, and lists comments', async () => {
    const c = await createComment({ target: 'terminal' });
    expect(c).toMatchObject({ status: 'queued', target: 'terminal' });
    const list = (await (await fetch(`${base}/comments`)).json()) as { comments: Comment[] };
    expect(list.comments.map((x) => x.id)).toEqual([c.id]);
  });

  it('delivers to a registered target', async () => {
    const delivered: Comment[] = [];
    registry.register({ name: 'terminal', kind: 'terminal', send: async (comment) => void delivered.push(comment) });
    const c = await createComment({ target: 'terminal' });
    expect(c.status).toBe('sent');
    expect(delivered.map((d) => d.id)).toEqual([c.id]);
  });

  it('marks failed when delivery throws, and resends to a new target', async () => {
    registry.register({ name: 'flaky', kind: 'listener', send: async () => Promise.reject(new Error('socket closed')) });
    const c = await createComment({ target: 'flaky' });
    expect(c.status).toBe('failed');
    expect(c.note).toMatch(/socket closed/);

    registry.register({ name: 'ui-chat', kind: 'listener', send: async () => {} });
    const res = await post(`/comments/${c.id}/send`, { target: 'ui-chat' });
    expect(((await res.json()) as { comment: Comment }).comment).toMatchObject({ status: 'sent', target: 'ui-chat' });
  });

  it('does not auto-send queued comments when a target registers', async () => {
    const c = await createComment({ target: 'terminal' });
    registry.register({ name: 'terminal', kind: 'terminal', send: async () => {} });
    expect(mod.service!.store.get(c.id)?.status).toBe('queued');
    const res = await post(`/comments/${c.id}/send`);
    expect(((await res.json()) as { comment: Comment }).comment.status).toBe('sent');
  });

  it('keeps a done that lands while delivery is pending', async () => {
    registry.register({
      name: 'terminal',
      kind: 'terminal',
      send: async (comment) => void mod.service!.markDone(comment.id, 'quick'),
    });
    const c = await createComment({ target: 'terminal' });
    expect(c).toMatchObject({ status: 'done', note: 'quick' });
  });

  it('marks done with a note, fails with a reason, and deletes', async () => {
    const c = await createComment();
    const done = await post(`/comments/${c.id}/done`, { note: 'Heading is now 40px' });
    expect(((await done.json()) as { comment: Comment }).comment).toMatchObject({ status: 'done', note: 'Heading is now 40px' });
    const failed = await post(`/comments/${c.id}/fail`, { reason: 'could not find file' });
    expect(((await failed.json()) as { comment: Comment }).comment).toMatchObject({ status: 'failed', note: 'could not find file' });
    expect((await fetch(`${base}/comments/${c.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(mod.service!.store.list()).toEqual([]);
  });
});

describe('targets and events', () => {
  it('lists targets, terminal first', async () => {
    registry.register({ name: 'zeta', kind: 'listener', send: async () => {} });
    registry.register({ name: 'terminal', kind: 'terminal', send: async () => {} });
    registry.register({ name: 'alpha', kind: 'listener', send: async () => {} });
    const body = (await (await fetch(`${base}/targets`)).json()) as { targets: unknown };
    expect(body.targets).toEqual([
      { name: 'terminal', kind: 'terminal' },
      { name: 'alpha', kind: 'listener' },
      { name: 'zeta', kind: 'listener' },
    ]);
  });

  it('only removes the exact target an unregister function was issued for', () => {
    const first = registry.register({ name: 'chat', kind: 'listener', send: async () => {} });
    registry.register({ name: 'chat', kind: 'listener', send: async () => {} });
    first();
    expect(registry.list()).toEqual([{ name: 'chat', kind: 'listener' }]);
  });

  it('broadcasts targets and comment changes over WS /events', async () => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/events');
    const events: ServerEvent[] = [];
    ws.on('message', (data) => events.push(JSON.parse(String(data))));
    await new Promise((resolve) => ws.once('open', resolve));
    await waitFor(() => events.length >= 1);
    expect(events[0]).toEqual({ type: 'targets', targets: [] });

    const unregister = registry.register({ name: 'terminal', kind: 'terminal', send: async () => {} });
    const c = await createComment({ target: 'terminal' });
    await post(`/comments/${c.id}/done`, { note: 'ok' });
    unregister();
    await fetch(`${base}/comments/${c.id}`, { method: 'DELETE' });
    await waitFor(() => events.some((e) => e.type === 'comment-deleted'));
    ws.close();

    expect(events.map((e) => (e.type === 'comment' ? `comment:${e.comment.status}` : e.type))).toEqual([
      'targets',
      'targets',
      'comment:queued',
      'comment:sent',
      'comment:done',
      'targets',
      'comment-deleted',
    ]);
  });
});

async function waitFor(check: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
