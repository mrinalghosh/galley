import { describe, expect, it } from 'vitest';
import { captureErrors, ErrorRing, fromErrorEvent, fromRejection, MAX_CAPTURED_ERRORS } from './errors.js';

const AT = new Date('2026-09-29T10:00:00.000Z');

function entry(n: number) {
  return { message: `Error ${n}`, at: AT.toISOString() };
}

describe('ErrorRing', () => {
  it('keeps only the most recent 20, oldest first', () => {
    const ring = new ErrorRing();
    for (let i = 1; i <= 25; i++) ring.push(entry(i));
    expect(ring.size).toBe(MAX_CAPTURED_ERRORS);
    expect(ring.list()[0]!.message).toBe('Error 6');
    expect(ring.list().at(-1)!.message).toBe('Error 25');
  });

  it('notifies subscribers with a snapshot on push and clear', () => {
    const ring = new ErrorRing(3);
    const seen: number[] = [];
    const unsubscribe = ring.subscribe((list) => seen.push(list.length));
    ring.push(entry(1));
    ring.push(entry(2));
    ring.clear();
    ring.clear(); // already empty: no event
    unsubscribe();
    ring.push(entry(3));
    expect(seen).toEqual([1, 2, 0]);
  });

  it('hands out copies, so callers cannot change the ring', () => {
    const ring = new ErrorRing();
    ring.push(entry(1));
    ring.list().pop();
    expect(ring.size).toBe(1);
  });
});

describe('fromErrorEvent', () => {
  it('uses the error type, message and stack', () => {
    const error = new TypeError('x is undefined');
    error.stack = 'TypeError: x is undefined\n    at onClick (http://localhost:5350/src/App.tsx:4:9)';
    expect(fromErrorEvent({ message: 'Uncaught TypeError: x is undefined', error }, AT)).toEqual({
      message: 'TypeError: x is undefined',
      stack: error.stack,
      at: AT.toISOString(),
    });
  });

  it('falls back to the event message and source location when no Error was thrown', () => {
    const captured = fromErrorEvent({ message: 'Script error.', error: null, filename: 'http://localhost:5350/a.js', lineno: 3, colno: 7 }, AT);
    expect(captured).toEqual({ message: 'Script error.', stack: 'at http://localhost:5350/a.js:3:7', at: AT.toISOString() });
  });

  it('ignores errors thrown by the overlay itself', () => {
    const error = new Error('oops');
    error.stack = 'Error: oops\n    at App (http://localhost:5350/__galley/overlay.js:12:3)';
    expect(fromErrorEvent({ message: 'Uncaught Error: oops', error }, AT)).toBeUndefined();
    expect(fromErrorEvent({ message: 'oops', filename: 'http://localhost:5350/__galley/overlay.js' }, AT)).toBeUndefined();
  });
});

describe('fromRejection', () => {
  it('uses the reason’s stack when it is an Error', () => {
    const reason = new Error('fetch failed');
    reason.stack = 'Error: fetch failed\n    at load (http://localhost:5350/src/api.ts:2:11)';
    expect(fromRejection(reason, AT)).toEqual({
      message: 'Unhandled promise rejection: Error: fetch failed',
      stack: reason.stack,
      at: AT.toISOString(),
    });
  });

  it('uses a string form for other reasons', () => {
    expect(fromRejection({ code: 42 }, AT)).toEqual({
      message: 'Unhandled promise rejection: {"code":42}',
      stack: '{"code":42}',
      at: AT.toISOString(),
    });
    expect(fromRejection('nope', AT)?.message).toBe('Unhandled promise rejection: nope');
    expect(fromRejection(undefined, AT)?.message).toBe('Unhandled promise rejection: undefined');
  });

  it('ignores rejections from the overlay itself', () => {
    const reason = new Error('screenshot');
    reason.stack = 'Error: screenshot\n    at capture (http://localhost:5350/__galley/overlay.js:99:1)';
    expect(fromRejection(reason, AT)).toBeUndefined();
  });
});

describe('captureErrors', () => {
  it('records error and unhandledrejection events until removed', () => {
    const target = new EventTarget();
    const ring = new ErrorRing();
    const stop = captureErrors(target as unknown as Window, ring);
    const error = Object.assign(new Event('error'), { message: 'Uncaught Error: boom', error: new Error('boom') });
    target.dispatchEvent(error);
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'late' }));
    stop();
    target.dispatchEvent(error);
    expect(ring.list().map((e) => e.message)).toEqual(['Error: boom', 'Unhandled promise rejection: late']);
  });
});
