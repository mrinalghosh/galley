// The WS /pty wire format (src/shared/pty.ts).
import { describe, expect, it } from 'vitest';
import { clampSize, isPtyServerMessage, parsePtyClientMessage } from '../../shared/pty.js';

describe('parsePtyClientMessage', () => {
  it('accepts resize and restart', () => {
    expect(parsePtyClientMessage('{"type":"resize","cols":120,"rows":40}')).toEqual({ type: 'resize', cols: 120, rows: 40 });
    expect(parsePtyClientMessage('{"type":"restart","extra":1}')).toEqual({ type: 'restart' });
  });

  it('caps huge sizes', () => {
    expect(parsePtyClientMessage('{"type":"resize","cols":99999,"rows":99999}')).toEqual({ type: 'resize', cols: 1000, rows: 500 });
  });

  it('rejects malformed frames', () => {
    for (const text of ['', 'nope', 'null', '[]', '{"type":"kill"}', '{"type":"resize","cols":0,"rows":10}', '{"type":"resize","cols":1.5,"rows":10}']) {
      expect(parsePtyClientMessage(text), text).toBeUndefined();
    }
  });
});

describe('clampSize', () => {
  it('parses query-string sizes', () => {
    expect(clampSize('80', 1000)).toBe(80);
    expect(clampSize(null, 1000)).toBeUndefined();
    expect(clampSize('-3', 1000)).toBeUndefined();
    expect(clampSize('abc', 1000)).toBeUndefined();
  });
});

describe('isPtyServerMessage', () => {
  it('recognises status and reset', () => {
    expect(isPtyServerMessage({ type: 'reset' })).toBe(true);
    expect(isPtyServerMessage({ type: 'status', status: { state: 'running', command: 'claude', pid: 1 } })).toBe(true);
    expect(isPtyServerMessage({ type: 'status' })).toBe(false);
    expect(isPtyServerMessage('reset')).toBe(false);
  });
});
