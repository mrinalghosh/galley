// done / fail / listen commands against a real in-process server.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { ServerEvent } from '../shared/protocol.js';
import { sampleComment } from '../server/comments/fixtures.js';
import { startTestServer, type TestServer } from '../server/listen/testing.js';
import { done, fail, parseMarkArgs } from './done.js';
import { listenUrl } from './listen.js';
import { findServer } from './server-client.js';

const PORT = 5326;
let server: TestServer;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  server = await startTestServer(PORT);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  log.mockRestore();
  await server.close();
});

function createQueued() {
  const service = server.comments.service!;
  return service.store.create(sampleComment({ target: 'queue' }));
}

describe('galley done / fail', () => {
  it('marks a comment done with its note and broadcasts it', async () => {
    const comment = createQueued();
    const events = new WebSocket(`ws://localhost:${PORT}/__galley/events?token=test-token`);
    const seen = new Promise<ServerEvent>((resolve) =>
      events.on('message', (data) => {
        const event = JSON.parse(data.toString()) as ServerEvent;
        if (event.type === 'comment' && event.comment.status === 'done') resolve(event);
      }),
    );
    await new Promise((resolve) => events.once('open', resolve));

    await done([comment.id, 'Made the heading 40px', '--cwd', server.cwd]);
    expect(server.comments.service!.store.get(comment.id)).toMatchObject({ status: 'done', note: 'Made the heading 40px' });
    expect(log).toHaveBeenCalledWith(`galley: ${comment.id} marked done: Made the heading 40px`);
    expect(await seen).toMatchObject({ comment: { id: comment.id, note: 'Made the heading 40px' } });
    events.close();
  });

  it('marks a comment failed with the reason, found from a subfolder', async () => {
    const comment = createQueued();
    const nested = join(server.cwd, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    await fail([comment.id, 'no', 'such', 'element', '--cwd', nested]);
    expect(server.comments.service!.store.get(comment.id)).toMatchObject({ status: 'failed', note: 'no such element' });
  });

  it('reports an unknown comment', async () => {
    await expect(done(['c_missing', 'x', '--cwd', server.cwd])).rejects.toThrow(/404.*no comment c_missing/);
  });

  it('parses arguments', () => {
    expect(parseMarkArgs('done', ['c_1', 'note', '--cwd', '/p'])).toEqual({ id: 'c_1', text: 'note', cwd: '/p' });
    expect(parseMarkArgs('done', ['c_1'])).toMatchObject({ id: 'c_1', text: undefined });
    expect(() => parseMarkArgs('fail', [])).toThrow(/usage/);
    expect(() => parseMarkArgs('done', ['../x'])).toThrow(/invalid comment id/);
  });
});

describe('finding the server', () => {
  let empty: string;
  beforeEach(() => {
    empty = mkdtempSync(join(tmpdir(), 'galley-none-'));
  });
  afterEach(() => rmSync(empty, { recursive: true, force: true }));

  it('explains when no server is running', async () => {
    await expect(done(['c_1', 'x', '--cwd', empty])).rejects.toThrow(/no galley server running/);
  });

  it('spots a stale server.json', async () => {
    mkdirSync(join(empty, '.galley'));
    writeFileSync(join(empty, '.galley', 'server.json'), JSON.stringify({ port: 5329, pid: 2 ** 22 + 7, target: 'x', startedAt: 'x' }));
    await expect(findServer(empty)).rejects.toThrow(/not running/);
  });
});

describe('galley listen URL', () => {
  it('connects with the token and a URL-encoded name', async () => {
    const url = listenUrl(PORT, 'my chat', 'test-token');
    expect(url).toBe(`ws://127.0.0.1:${PORT}/__galley/listen?name=my+chat&token=test-token`);
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    expect(server.listen.names()).toEqual(['my chat']);
    ws.close();
  });
});
