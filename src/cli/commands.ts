// Subcommand dispatch. `galley <target-url> [options]` starts the proxy; a first
// argument naming a command runs it instead. Later milestones (init, done, fail,
// listen) add one entry to COMMANDS and put their code in their own file.
import { done, fail } from './done.js';
import { init } from './init.js';
import { listen } from './listen.js';
import { start } from './start.js';

export type Command = (args: string[]) => Promise<void> | void;

const USAGE = `Usage:
  galley <target-url> [--port 5300] [--cwd .] [--agent claude] [--open]

  Proxies a running local dev server, opens a shell with the site framed and
  an overlay for leaving comments that Claude Code chats pick up.

Options:
  --port <n>      Port for the proxy on 127.0.0.1 (default 5300)
  --cwd <dir>     Project folder: where .galley/ lives and agents run (default .)
  --agent <cmd>   Command for the browser terminal (default claude)
  --open          Open the shell in the default browser
  -h, --help      Show this help

Commands:
  galley init [--force]                     Install the /galley command for Claude Code
  galley listen --name <name> [--cwd dir]   Print comments sent to <name> as they arrive
  galley done <id> "<note>" [--cwd dir]     Mark a comment done
  galley fail <id> "<reason>" [--cwd dir]   Mark a comment failed
`;

/** Subcommands by name. Anything else is treated as `start <target-url>`. */
export const COMMANDS: Record<string, Command> = {
  start,
  help: () => void process.stdout.write(USAGE),
  init,
  listen,
  done,
  fail,
};

export async function main(argv: string[]): Promise<void> {
  const [first, ...rest] = argv;
  if (first === undefined || first === '-h' || first === '--help') {
    process.stdout.write(USAGE);
    if (first === undefined) process.exitCode = 1;
    return;
  }
  const command = COMMANDS[first];
  if (command) return command(rest);
  return start(argv);
}
