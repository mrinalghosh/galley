import { describe, expect, it } from 'vitest';
import { parseStartArgs, parseTarget } from './start.js';

describe('parseTarget', () => {
  it('accepts full URLs, host:port and bare ports', () => {
    expect(parseTarget('http://localhost:5173/app').href).toBe('http://localhost:5173/app');
    expect(parseTarget('localhost:3000').href).toBe('http://localhost:3000/');
    expect(parseTarget('5202').href).toBe('http://localhost:5202/');
    expect(parseTarget('https://127.0.0.1:8443').protocol).toBe('https:');
  });

  it('rejects other schemes', () => {
    expect(() => parseTarget('ftp://x')).toThrow(/http or https/);
  });
});

describe('parseStartArgs', () => {
  it('applies defaults', () => {
    const options = parseStartArgs(['5202']);
    expect(options).toMatchObject({ port: 5300, agent: 'claude', open: false });
    expect(options.cwd).toBe(process.cwd());
  });

  it('reads every flag', () => {
    const options = parseStartArgs(['http://localhost:5202', '--port', '5301', '--cwd', '/tmp', '--agent', 'claude --model x', '--open']);
    expect(options).toMatchObject({ port: 5301, cwd: '/tmp', agent: 'claude --model x', open: true });
  });

  it('rejects a missing target, a bad port and stray arguments', () => {
    expect(() => parseStartArgs([])).toThrow(/missing <target-url>/);
    expect(() => parseStartArgs(['5202', '--port', '99999'])).toThrow(/invalid --port/);
    expect(() => parseStartArgs(['5202', 'extra'])).toThrow(/unexpected argument/);
  });
});
