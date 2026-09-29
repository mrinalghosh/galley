import { describe, expect, it } from 'vitest';
import { agentEnv, parseAgentCommand, splitCommand } from './command.js';

describe('splitCommand', () => {
  it('splits on whitespace', () => {
    expect(splitCommand('claude')).toEqual(['claude']);
    expect(splitCommand('  claude   --model  opus ')).toEqual(['claude', '--model', 'opus']);
  });

  it('honours quotes and escapes without any shell expansion', () => {
    expect(splitCommand(`claude --append "a b" 'c "d"' e\\ f`)).toEqual(['claude', '--append', 'a b', 'c "d"', 'e f']);
    expect(splitCommand(`echo "\\"q\\" \\n" '$HOME' $(rm -rf)`)).toEqual(['echo', '"q" \\n', '$HOME', '$(rm', '-rf)']);
    expect(splitCommand(`x ""`)).toEqual(['x', '']);
  });

  it('rejects an unterminated quote', () => {
    expect(() => splitCommand('claude "oops')).toThrow(/unterminated/);
  });
});

describe('parseAgentCommand', () => {
  it('returns file and args', () => {
    expect(parseAgentCommand('bash --norc -i')).toEqual({ file: 'bash', args: ['--norc', '-i'] });
  });

  it('refuses permission-bypass flags', () => {
    expect(() => parseAgentCommand('claude --dangerously-skip-permissions')).toThrow(/never bypasses/);
    expect(() => parseAgentCommand('claude --allow-dangerously-skip-permissions')).toThrow(/never bypasses/);
    expect(() => parseAgentCommand('claude --permission-mode bypassPermissions')).toThrow(/never bypasses/);
    expect(() => parseAgentCommand('claude --permission-mode=bypassPermissions')).toThrow(/never bypasses/);
    expect(parseAgentCommand('claude --permission-mode plan').args).toEqual(['--permission-mode', 'plan']);
  });

  it('rejects an empty command', () => {
    expect(() => parseAgentCommand('   ')).toThrow(/empty/);
  });
});

describe('agentEnv', () => {
  it('inherits the environment, sets TERM and drops parent Claude Code session markers', () => {
    const env = agentEnv({ PATH: '/bin', HOME: '/h', TERM: 'dumb', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', ANTHROPIC_API_KEY: 'k', GONE: undefined });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', TERM: 'xterm-256color', COLORTERM: 'truecolor', ANTHROPIC_API_KEY: 'k' });
  });
});
