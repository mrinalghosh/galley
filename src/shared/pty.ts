// WS PREFIX/pty: the browser terminal's wire protocol, shared by server and shell.
//
// Binary frames carry terminal bytes (UTF-8): server -> client is pty output,
// client -> server is keyboard input. Text frames carry one JSON control
// message each. Connect with ?cols=&rows= so a fresh session spawns at the
// viewer's size.

export type PtyState = 'starting' | 'running' | 'exited' | 'disabled';

export interface PtyStatus {
  state: PtyState;
  /** The agent command line, e.g. "claude". */
  command: string;
  pid?: number;
  /** Set when state is 'exited'. null when the process was killed by a signal or never started. */
  exitCode?: number | null;
  signal?: number;
  /** Why the terminal is disabled, or why spawning failed. */
  message?: string;
}

export type PtyServerMessage =
  /** Current session status. Sent on connect and on every change. */
  | { type: 'status'; status: PtyStatus }
  /** Clear the screen: the scrollback replay (or a restarted session's output) follows. */
  | { type: 'reset' };

export type PtyClientMessage =
  /** The viewer's terminal size. The last viewer to resize sets the pty size. */
  | { type: 'resize'; cols: number; rows: number }
  /** Kill the current process (if any) and spawn a new one. */
  | { type: 'restart' };

export const PTY_PATH = '/pty';

export function isPtyServerMessage(value: unknown): value is PtyServerMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as { type?: unknown; status?: unknown };
  if (message.type === 'reset') return true;
  return message.type === 'status' && !!message.status && typeof message.status === 'object';
}

/** Parses a client control frame. Returns undefined for anything malformed. */
export function parsePtyClientMessage(text: string): PtyClientMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const message = value as { type?: unknown; cols?: unknown; rows?: unknown };
  if (message.type === 'restart') return { type: 'restart' };
  if (message.type !== 'resize') return undefined;
  const cols = clampSize(message.cols, MAX_COLS);
  const rows = clampSize(message.rows, MAX_ROWS);
  return cols && rows ? { type: 'resize', cols, rows } : undefined;
}

const MAX_COLS = 1000;
const MAX_ROWS = 500;

/** A positive integer terminal dimension, capped; undefined when invalid. */
export function clampSize(value: unknown, max: number): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return undefined;
  return Math.min(n, max);
}

export const PTY_LIMITS = { MAX_COLS, MAX_ROWS } as const;
