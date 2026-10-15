// Turns --agent into argv and the environment for the pty. No shell is
// involved: the command is split with simple POSIX-style quoting and spawned
// directly, so nothing in it is expanded or executed by a shell.

export interface AgentCommand {
  file: string;
  args: string[];
}

/** Splits `claude --model "x y"` into argv. Supports '…', "…" and backslash escapes. */
export function splitCommand(input: string): string[] {
  const words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: '"' | "'" | undefined;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      else word += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < input.length && (quote !== '"' || '"\\$`'.includes(input[i + 1]!))) {
      word += input[++i];
      inWord = true;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = undefined;
      else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    } else {
      word += ch;
      inWord = true;
    }
  }
  if (quote) throw new Error(`unterminated ${quote} quote in --agent`);
  if (inWord) words.push(word);
  return words;
}

// galley never bypasses Claude Code's permission prompts, even when asked to.
const BYPASS_FLAGS = ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions'];

export function parseAgentCommand(agent: string): AgentCommand {
  const [file, ...args] = splitCommand(agent);
  if (!file) throw new Error('--agent is empty');
  const bypass = args.find((arg, i) => BYPASS_FLAGS.includes(arg) || isBypassMode(arg, args[i + 1]));
  if (bypass) throw new Error(`refusing to start the agent with "${bypass}": galley never bypasses permission prompts`);
  return { file, args };
}

function isBypassMode(arg: string, next: string | undefined): boolean {
  if (arg === '--permission-mode') return next === 'bypassPermissions';
  return arg === '--permission-mode=bypassPermissions';
}

// Set by a Claude Code session for its own child processes. The browser
// terminal is a fresh, top-level session, so it must not inherit them even
// when galley itself was started from inside Claude Code.
const PARENT_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_PID',
];

export function agentEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !PARENT_SESSION_VARS.includes(key)) env[key] = value;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  return env;
}
