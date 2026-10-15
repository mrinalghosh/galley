import { describe, expect, it } from 'vitest';
import { RingBuffer, SCROLLBACK_BYTES } from './ring.js';

describe('RingBuffer', () => {
  it('keeps everything under the cap, in order', () => {
    const ring = new RingBuffer(100);
    ring.push('hello ');
    ring.push('');
    ring.push('world');
    expect(ring.contents()).toBe('hello world');
    expect(ring.size).toBe(11);
  });

  it('drops the oldest chunks once over the cap', () => {
    const ring = new RingBuffer(10);
    ring.push('aaaa');
    ring.push('bbbb');
    ring.push('cccc');
    expect(ring.contents()).toBe('bbbbcccc');
    expect(ring.size).toBe(8);
  });

  it('keeps the tail of a single chunk larger than the cap', () => {
    const ring = new RingBuffer(5);
    ring.push('0123456789');
    expect(ring.contents()).toBe('56789');
  });

  it('counts UTF-8 bytes and never splits a character', () => {
    const ring = new RingBuffer(7);
    ring.push('ab€€'); // 2 + 3 + 3 = 8 bytes
    expect(ring.contents()).toBe('b€€');
    ring.push('é'); // 9 bytes: whole older chunks are dropped first
    expect(ring.contents()).toBe('é');
    expect(ring.size).toBe(2);
  });

  it('clear() empties it', () => {
    const ring = new RingBuffer();
    ring.push('x');
    ring.clear();
    expect(ring.contents()).toBe('');
    expect(ring.size).toBe(0);
  });

  it('defaults to 256 KB and stays within it under sustained output', () => {
    const ring = new RingBuffer();
    const line = `${'x'.repeat(99)}\n`;
    for (let i = 0; i < 5000; i++) ring.push(line);
    expect(SCROLLBACK_BYTES).toBe(256 * 1024);
    expect(ring.size).toBeLessThanOrEqual(SCROLLBACK_BYTES);
    expect(ring.size).toBeGreaterThan(SCROLLBACK_BYTES - line.length);
    expect(ring.contents().endsWith(line)).toBe(true);
  });
});
