import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerEvent } from '../../shared/protocol.js';
import { sampleComment } from './fixtures.js';
import { COMMENT_ID_PATTERN, newCommentId } from './ids.js';
import { CommentStore, foldRecords, parseLog } from './store.js';

describe('newCommentId', () => {
  it('is short, well-formed and sorts by creation time', () => {
    const ids = [newCommentId(1_700_000_000_000), newCommentId(1_700_000_000_001), newCommentId(1_800_000_000_000)];
    for (const id of ids) expect(id).toMatch(COMMENT_ID_PATTERN);
    expect([...ids].sort()).toEqual(ids);
  });

  it('stays unique and ordered within one millisecond', () => {
    const ids = Array.from({ length: 1000 }, () => newCommentId(1_900_000_000_000));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('never goes backwards if the clock does', () => {
    const later = newCommentId(2_000_000_000_000);
    const earlier = newCommentId(1_000_000_000_000);
    expect(earlier > later).toBe(true);
  });
});

describe('foldRecords', () => {
  const base = { ...sampleComment(), id: 'c_1', createdAt: '2026-01-01T00:00:00.000Z', status: 'queued' as const };

  it('applies status changes in order and keeps notes with their state', () => {
    const state = foldRecords([
      { type: 'comment', comment: base },
      { type: 'status', id: 'c_1', status: 'sent', target: 'terminal', at: 't1' },
      { type: 'status', id: 'c_1', status: 'done', note: 'Bumped to 40px', at: 't2' },
    ]);
    expect(state.get('c_1')).toMatchObject({ status: 'done', note: 'Bumped to 40px', target: 'terminal' });

    const resent = foldRecords([
      { type: 'comment', comment: base },
      { type: 'status', id: 'c_1', status: 'failed', note: 'boom', at: 't1' },
      { type: 'status', id: 'c_1', status: 'sent', at: 't2' },
    ]);
    expect(resent.get('c_1')?.note).toBeUndefined();
  });

  it('drops deleted comments and ignores events for unknown ids', () => {
    const state = foldRecords([
      { type: 'status', id: 'c_0', status: 'done', at: 't0' },
      { type: 'comment', comment: base },
      { type: 'comment', comment: { ...base, id: 'c_2' } },
      { type: 'delete', id: 'c_1', at: 't1' },
    ]);
    expect([...state.keys()]).toEqual(['c_2']);
  });

  it('skips corrupt lines', () => {
    const text = `${JSON.stringify({ type: 'comment', comment: base })}\n{"type":"sta\n\n42\n`;
    expect(parseLog(text)).toHaveLength(1);
  });
});

describe('CommentStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'galley-store-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('persists comments and events, and folds them on reload', () => {
    const store = new CommentStore(dir);
    const a = store.create(sampleComment({ text: 'first' }));
    const b = store.create(sampleComment({ text: 'second' }));
    store.setStatus(a.id, { status: 'done', note: 'did it' });
    store.delete(b.id);

    const lines = readFileSync(join(dir, 'comments.jsonl'), 'utf8').trim().split('\n');
    expect(lines.map((line) => JSON.parse(line).type)).toEqual(['comment', 'comment', 'status', 'delete']);

    const reloaded = new CommentStore(dir);
    expect(reloaded.list()).toEqual([{ ...a, status: 'done', note: 'did it' }]);
  });

  it('survives a torn final line', () => {
    const store = new CommentStore(dir);
    const a = store.create(sampleComment());
    appendFileSync(join(dir, 'comments.jsonl'), '{"type":"status","id":');
    expect(new CommentStore(dir).get(a.id)?.text).toBe(a.text);
  });

  it('emits an event for every change', () => {
    const store = new CommentStore(dir);
    const events: ServerEvent[] = [];
    store.onEvent((event) => events.push(event));
    const a = store.create(sampleComment());
    store.setStatus(a.id, { status: 'sent' });
    store.delete(a.id);
    expect(events.map((e) => e.type)).toEqual(['comment', 'comment', 'comment-deleted']);
    expect(events[1]).toMatchObject({ type: 'comment', comment: { id: a.id, status: 'sent' } });
  });

  it('writes screenshots to shots/<id>.png and stores the absolute path', () => {
    const store = new CommentStore(dir);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const a = store.create(sampleComment({ screenshotDataUrl: `data:image/png;base64,${png.toString('base64')}` }));
    expect(a.screenshot).toBe(join(dir, 'shots', `${a.id}.png`));
    expect(readFileSync(a.screenshot!)).toEqual(png);
    expect(a).not.toHaveProperty('screenshotDataUrl');
    store.delete(a.id);
    expect(existsSync(a.screenshot!)).toBe(false);
  });

  it('returns undefined or false for unknown ids', () => {
    const store = new CommentStore(dir);
    expect(store.setStatus('c_missing', { status: 'done' })).toBeUndefined();
    expect(store.delete('c_missing')).toBe(false);
  });
});
