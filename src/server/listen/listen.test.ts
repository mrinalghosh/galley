// The listen module over real sockets: a galley server in-process and ws clients
// connecting the way a Claude Code Monitor does (no Origin, ?token=).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { Comment, TargetInfo } from '../../shared/protocol.js';
import { sampleComment } from '../comments/fixtures.js';
import { startTestServer, type TestServer } from './testing.js';

const PORT = 5325;
let server: TestServer;

beforeEach(async () => {
  server = await startTestServer(PORT, 50);
});

afterEach(async () => {
  await server.close();
});

const auth = { authorization: 'Bearer test-token', 'content-type': 'application/json' };

function listenUrl(name: string, token = 'test-token'): string {
  return `ws://localhost:${PORT}/__galley/listen?name=${encodeURIComponent(name)}&token=${token}`;
}

interface Client {
  ws: WebSocket;
  frames: string[];
  next(): Promise<string>;
}

function connect(name: string, options: WebSocket.ClientOptions = {}): Promise<Client> {
  const ws = new WebSocket(listenUrl(name), options);
  const frames: string[] = [];
  const waiters: ((frame: string) => void)[] = [];
  let consumed = 0;
  ws.on('message', (data) => {
    frames.push(data.toString());
    const waiter = waiters.shift();
    if (waiter) waiter(frames[consumed++]!);
  });
  // A frame may land before anyone asks for it (e.g. right on connect).
  const next = () =>
    new Promise<string>((resolve) => (consumed < frames.length ? resolve(frames[consumed++]!) : waiters.push(resolve)));
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, frames, next }));
    ws.once('error', reject);
  });
}

/** Resolves with the HTTP status of a refused upgrade. */
function refusedStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('open', () => reject(new Error('upgrade was accepted')));
    ws.on('error', () => {});
  });
}

async function targets(): Promise<TargetInfo[]> {
  const res = await fetch(`${server.base}/targets`, { headers: auth });
  return ((await res.json()) as { targets: TargetInfo[] }).targets;
}

async function createComment(target: string, text = 'Make the heading bigger'): Promise<Comment> {
  const res = await fetch(`${server.base}/comments`, { method: 'POST', headers: auth, body: JSON.stringify(sampleComment({ target, text })) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { comment: Comment }).comment;
}

function closed(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => (ws.readyState === WebSocket.CLOSED ? resolve() : ws.once('close', () => resolve())));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => Promise<boolean> | boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await sleep(10);
  }
}

describe('WS /listen', () => {
  it('refuses a missing token, a bad name and a reserved name', async () => {
    expect(await refusedStatus(`ws://localhost:${PORT}/__galley/listen?name=check`)).toBe(401);
    expect(await refusedStatus(listenUrl('check', 'wrong'))).toBe(401);
    expect(await refusedStatus(listenUrl('a/b'))).toBe(400);
    expect(await refusedStatus(listenUrl('terminal'))).toBe(400);
    expect(await refusedStatus(listenUrl('queue'))).toBe(400);
  });

  it('delivers one frame per comment and marks it sent', async () => {
    const client = await connect('check');
    expect(await targets()).toEqual([{ name: 'check', kind: 'listener' }]);

    const frame = client.next();
    const created = await createComment('check');
    expect(created.status).toBe('sent');
    const text = await frame;
    expect(text).toContain(`[${created.id}] Make the heading bigger`);
    expect(text).toContain(`Done: galley done ${created.id} "<note>" --cwd ${server.cwd}`);
    expect(text).toContain(`Page: http://localhost:${PORT}/?tab=1`);
    await sleep(150); // a few ping intervals: pings must not show up as frames
    expect(client.frames).toHaveLength(1);
    client.ws.close();
  });

  it('refuses a second live listener with the same name', async () => {
    const first = await connect('check');
    expect(await refusedStatus(listenUrl('check'))).toBe(409);
    first.ws.close();
    await closed(first.ws);
    await waitFor(async () => (await targets()).length === 0);
    const second = await connect('check');
    expect(await targets()).toEqual([{ name: 'check', kind: 'listener' }]);
    second.ws.close();
  });

  it('drops the target on close, so later comments queue', async () => {
    const client = await connect('check');
    client.ws.close();
    await closed(client.ws);
    await waitFor(async () => (await targets()).length === 0);
    const comment = await createComment('check');
    expect(comment).toMatchObject({ status: 'queued', target: 'check' });
  });

  it('catches up on comments queued under its name while it was away, as one frame', async () => {
    const a = await createComment('check', 'While re-arming 1');
    const b = await createComment('check', 'While re-arming 2');
    const other = await createComment('queue', 'Generic queue');
    const client = await connect('check');
    const text = await client.next();
    expect(text).toContain(`[${a.id}]`);
    expect(text).toContain(`[${b.id}]`);
    expect(text).not.toContain(other.id);
    await waitFor(() => server.comments.service!.store.get(a.id)?.status === 'sent');
    expect(server.comments.service!.store.get(other.id)?.status).toBe('queued');
    client.ws.close();
  });

  it('terminates a listener that stops answering pings', async () => {
    const client = await connect('check', { autoPong: false });
    await closed(client.ws);
    await waitFor(async () => (await targets()).length === 0);
  });
});

describe('POST /queue/flush', () => {
  async function flush(body: unknown): Promise<Response> {
    return fetch(`${server.base}/queue/flush`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  }

  it('sends every queued comment to the target as one prompt', async () => {
    const a = await createComment('queue', 'First');
    const b = await createComment('someone-offline', 'Second');
    const client = await connect('check');
    const frame = client.next();

    const res = await flush({ target: 'check' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { target: string; comments: Comment[] };
    expect(body.comments.map((c) => [c.id, c.status, c.target])).toEqual([
      [a.id, 'sent', 'check'],
      [b.id, 'sent', 'check'],
    ]);
    const text = await frame;
    expect(text).toMatch(/^I left 2 comments on my page/);
    expect(text).toContain(`1. [${a.id}] First`);
    expect(text).toContain(`2. [${b.id}] Second`);
    await sleep(20);
    expect(client.frames).toHaveLength(1);

    const again = (await (await flush({ target: 'check' })).json()) as { comments: Comment[] };
    expect(again.comments).toEqual([]);
    client.ws.close();
  });

  it('flushes only the given ids', async () => {
    const a = await createComment('queue', 'First');
    const b = await createComment('queue', 'Second');
    const client = await connect('check');
    const body = (await (await flush({ target: 'check', ids: [b.id] })).json()) as { comments: Comment[] };
    expect(body.comments.map((c) => c.id)).toEqual([b.id]);
    const all = (await (await fetch(`${server.base}/comments`, { headers: auth })).json()) as { comments: Comment[] };
    expect(all.comments.find((c) => c.id === a.id)?.status).toBe('queued');
    client.ws.close();
  });

  it('rejects an unconnected target, the queue itself and bad bodies', async () => {
    expect((await flush({ target: 'nobody' })).status).toBe(409);
    expect((await flush({ target: 'queue' })).status).toBe(400);
    expect((await flush({})).status).toBe(400);
    expect((await flush({ target: 'x', ids: 'y' })).status).toBe(400);
    expect((await fetch(`${server.base}/queue/flush`, { headers: auth })).status).toBe(405);
  });
});
