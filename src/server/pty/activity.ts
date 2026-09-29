// Is the agent idle and waiting for input? Two signals from the pty output:
//
// 1. Quiet: no output for QUIET_MS. Claude Code redraws its spinner several
//    times a second while it works, so silence means it has stopped.
// 2. Progress reports: Claude Code emits OSC 9;4 (terminal progress) in some
//    terminals: state 3 while a turn runs, 0 when it ends. The turn stays "in
//    progress" while a permission prompt waits, so this keeps a delivery from
//    being pasted into that prompt. Agents that never report are judged on
//    quiet alone.
//
// Terminal queries don't count as output: see queries.ts.
import { stripTerminalQueries } from './queries.js';

export const QUIET_MS = 1500;
const BUSY_POLL_MS = 250;

// ESC ] 9 ; 4 ; <state> [; <value>] terminated by BEL or ESC \
const PROGRESS = /\x1b\]9;4;(\d)(?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g;
// Longest partial progress sequence we keep between chunks.
const CARRY = 32;

export class ActivityMonitor {
  private last: number;
  private progress: 'unknown' | 'busy' | 'idle' = 'unknown';
  private carry = '';

  constructor(
    private readonly quietMs = QUIET_MS,
    private readonly now: () => number = Date.now,
  ) {
    this.last = now();
  }

  /** Feed every chunk of pty output. */
  observe(data: string): void {
    if (stripTerminalQueries(data)) this.last = this.now();
    const text = this.carry + data;
    for (const match of text.matchAll(PROGRESS)) {
      this.progress = match[1] === '0' ? 'idle' : 'busy';
    }
    this.carry = partialProgress(text);
  }

  /** Marks activity that produced no output yet, e.g. a prompt we just submitted. */
  touch(): void {
    this.last = this.now();
  }

  /** A fresh process: forget what the previous one reported. */
  reset(): void {
    this.last = this.now();
    this.progress = 'unknown';
    this.carry = '';
  }

  get reportedBusy(): boolean {
    return this.progress === 'busy';
  }

  isIdle(): boolean {
    return !this.reportedBusy && this.now() - this.last >= this.quietMs;
  }

  /** Resolves once the agent is idle. Rejects if `signal` aborts first. */
  waitForIdle(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError(signal!));
      };
      const check = () => {
        if (signal?.aborted) return onAbort();
        if (this.isIdle()) {
          signal?.removeEventListener('abort', onAbort);
          return resolve();
        }
        const wait = this.reportedBusy ? BUSY_POLL_MS : this.quietMs - (this.now() - this.last);
        timer = setTimeout(check, Math.max(1, wait));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      check();
    });
  }
}

const PROGRESS_PREFIX = '\x1b]9;4;';

/** The unfinished progress sequence at the end of `text`, if any, to prepend to the next chunk. */
function partialProgress(text: string): string {
  const start = text.lastIndexOf('\x1b');
  if (start < 0 || text.length - start >= CARRY) return '';
  const tail = text.slice(start);
  if (tail.length <= PROGRESS_PREFIX.length) return PROGRESS_PREFIX.startsWith(tail) ? tail : '';
  return tail.startsWith(PROGRESS_PREFIX) && !tail.includes('\x07') ? tail : '';
}

export function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('delivery cancelled');
}
