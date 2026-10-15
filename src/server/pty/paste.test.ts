import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityMonitor } from './activity.js';
import { bracketedPaste, PASTE_END, PASTE_START, PasteQueue } from './paste.js';

describe('bracketedPaste', () => {
  it('wraps text and keeps newlines and tabs', () => {
    expect(bracketedPaste('a\n\tb')).toBe(`${PASTE_START}a\n\tb${PASTE_END}`);
    expect(bracketedPaste('a\r\nb\rc')).toBe(`${PASTE_START}a\nb\nc${PASTE_END}`);
  });

  it('strips ESC and control characters so the paste cannot end early', () => {
    expect(bracketedPaste(`x${PASTE_END}\x03\x7fy`)).toBe(`${PASTE_START}x[201~y${PASTE_END}`);
  });
});

describe('PasteQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes the paste, then Enter 50 ms later', async () => {
    const writes: string[] = [];
    const queue = new PasteQueue({ write: (d) => writes.push(d) });
    const done = queue.enqueue('hello');
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual([bracketedPaste('hello')]);
    await vi.advanceTimersByTimeAsync(49);
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([bracketedPaste('hello'), '\r']);
    await expect(done).resolves.toBeUndefined();
  });

  it('never interleaves deliveries: each paste is followed by its own Enter', async () => {
    const writes: string[] = [];
    const queue = new PasteQueue({ write: (d) => writes.push(d) });
    const all = Promise.all(['one', 'two', 'three'].map((t) => queue.enqueue(t)));
    expect(queue.pending).toBe(3);
    await vi.advanceTimersByTimeAsync(500);
    await all;
    expect(writes).toEqual([bracketedPaste('one'), '\r', bracketedPaste('two'), '\r', bracketedPaste('three'), '\r']);
    expect(queue.pending).toBe(0);
  });

  it('with a gate, holds deliveries until output is quiet, then sends one at a time', async () => {
    const writes: { at: number; data: string }[] = [];
    const start = Date.now();
    const monitor = new ActivityMonitor(1500);
    const queue = new PasteQueue({ write: (data) => writes.push({ at: Date.now() - start, data }), gate: monitor });
    const all = Promise.all([queue.enqueue('first'), queue.enqueue('second')]);

    // The agent is busy for 5 s: output every 100 ms.
    for (let t = 0; t < 5000; t += 100) {
      monitor.observe('working');
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1400);
    expect(writes.map((w) => w.data)).toEqual([bracketedPaste('first')]);
    await vi.advanceTimersByTimeAsync(50);
    expect(writes.map((w) => w.data)).toEqual([bracketedPaste('first'), '\r']);

    // The agent starts on the first prompt; the second waits for it to go quiet again.
    for (let t = 0; t < 3000; t += 100) {
      monitor.observe('answering first');
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(writes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1600);
    await all;
    expect(writes.map((w) => w.data)).toEqual([bracketedPaste('first'), '\r', bracketedPaste('second'), '\r']);
    expect(writes[2]!.at - writes[1]!.at).toBeGreaterThanOrEqual(3000);
  });

  it('cancel() rejects the waiting deliveries and later ones still go out', async () => {
    const writes: string[] = [];
    const monitor = new ActivityMonitor(1500);
    const queue = new PasteQueue({ write: (d) => writes.push(d), gate: monitor });
    const a = queue.enqueue('a');
    const b = queue.enqueue('b');
    queue.cancel('the terminal exited');
    await expect(a).rejects.toThrow('the terminal exited');
    await expect(b).rejects.toThrow('the terminal exited');
    expect(writes).toEqual([]);

    const c = queue.enqueue('c');
    await vi.advanceTimersByTimeAsync(2000);
    await c;
    expect(writes).toEqual([bracketedPaste('c'), '\r']);
  });
});

describe('PasteQueue gate after a submit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits a full quiet period after its own Enter even if the agent is slow to respond', async () => {
    const writes: string[] = [];
    const monitor = new ActivityMonitor(1500);
    const queue = new PasteQueue({ write: (d) => writes.push(d), gate: monitor });
    void queue.enqueue('first');
    void queue.enqueue('second');
    await vi.advanceTimersByTimeAsync(1550);
    expect(writes).toEqual([bracketedPaste('first'), '\r']);
    await vi.advanceTimersByTimeAsync(1499);
    expect(writes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes[2]).toBe(bracketedPaste('second'));
  });
});
