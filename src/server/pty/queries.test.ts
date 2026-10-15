import { describe, expect, it } from 'vitest';
import { stripTerminalQueries } from './queries.js';

describe('stripTerminalQueries', () => {
  it('removes cursor, device and colour queries', () => {
    const queries = ['\x1b[?6n', '\x1b[6n', '\x1b[5n', '\x1b[c', '\x1b[0c', '\x1b[>c', '\x1b[>0c', '\x1b[>0q', '\x1b[?2026$p', '\x1b[?u', '\x1b]11;?\x07', '\x1b]4;1;?\x1b\\'];
    expect(stripTerminalQueries(queries.join(''))).toBe('');
    expect(stripTerminalQueries('\x1b[?6n'.repeat(500))).toBe('');
  });

  it('keeps output, including other escape sequences', () => {
    const output = '\x1b[?2026h\x1b[H\x1b[38;2;1;2;3mhello\x1b[39m\x1b[2C\x1b]0;✳ title\x07\x1b]9;4;0;\x07\x1b[?25h\x1b[K';
    expect(stripTerminalQueries(output)).toBe(output);
    expect(stripTerminalQueries(`a\x1b[?6nb`)).toBe('ab');
    expect(stripTerminalQueries('plain text')).toBe('plain text');
  });
});
