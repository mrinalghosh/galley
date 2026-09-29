import { describe, expect, it } from 'vitest';
import { validateListenerName } from './name.js';

describe('validateListenerName', () => {
  it.each(['check', 'my chat', 'a', 'x'.repeat(40), 'site-1.fix_up'])('accepts %j', (name) => {
    expect(validateListenerName(name)).toEqual({ ok: true, name });
  });

  it('trims surrounding spaces', () => {
    expect(validateListenerName('  chat ')).toEqual({ ok: true, name: 'chat' });
  });

  it.each([null, '', '   ', 'x'.repeat(41), 'a/b', 'émoji', 'a\nb', '<script>', 'terminal', 'queue', 'Terminal'])('rejects %j', (name) => {
    expect(validateListenerName(name).ok).toBe(false);
  });
});
