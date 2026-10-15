// The `terminal` delivery target: registered while the pty runs, it pastes
// each prompt into the agent once the agent is idle, one delivery at a time.
//
// Why wait for idle: Claude Code does accept a paste while it's busy, but it
// injects the queued text into the running turn (between tool calls) instead
// of submitting it as a new prompt after the turn ends. See the M4 notes.
import type { Comment } from '../../shared/protocol.js';
import type { PtyStatus } from '../../shared/pty.js';
import type { TargetRegistry } from '../comments/targets.js';
import type { BatchDeliveryTarget } from '../delivery/batch.js';
import { ActivityMonitor } from './activity.js';
import { PasteQueue } from './paste.js';
import type { PtySession } from './session.js';

export const TERMINAL_TARGET = 'terminal';

/**
 * How long send() waits for the paste before reporting the comment as handed
 * off anyway. It must stay under the comments service's 10 s delivery timeout;
 * a busy agent can hold a delivery much longer than that.
 */
export const HANDOFF_MS = 5000;

export interface TerminalDeliveryOptions {
  session: PtySession;
  registry: TargetRegistry;
  format(comments: Comment[]): string;
  /** Called for comments already reported as sent whose paste never happened (the pty exited first). */
  onDropped(comments: Comment[], reason: string): void;
  /** Wait for the agent to be idle before each paste. Default true. */
  gate?: boolean;
  monitor?: ActivityMonitor;
  handoffMs?: number;
}

export class TerminalDelivery {
  readonly monitor: ActivityMonitor;
  private readonly queue: PasteQueue;
  private unregister: (() => void) | undefined;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly options: TerminalDeliveryOptions) {
    const { session, gate = true } = options;
    this.monitor = options.monitor ?? new ActivityMonitor();
    this.queue = new PasteQueue({ write: (data) => session.input(data), gate: gate ? this.monitor : undefined });
    this.cleanups.push(
      session.onOutput((data) => this.monitor.observe(data)),
      session.onStatus((status) => this.onStatus(status)),
    );
    this.onStatus(session.current);
  }

  get pending(): number {
    return this.queue.pending;
  }

  close(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.stop('galley is shutting down');
  }

  private onStatus(status: PtyStatus): void {
    if (status.state === 'running') return this.start();
    // Starting again means a restart: deliveries meant for the old session are dropped.
    this.stop(`${describeStop(status)} before the comment was pasted`);
  }

  private start(): void {
    this.monitor.reset();
    const target: BatchDeliveryTarget = {
      name: TERMINAL_TARGET,
      kind: 'terminal',
      send: (comment) => this.deliver([comment]),
      sendBatch: (comments) => this.deliver(comments),
    };
    this.unregister?.();
    this.unregister = this.options.registry.register(target);
  }

  private stop(reason: string): void {
    this.unregister?.();
    this.unregister = undefined;
    this.queue.cancel(reason);
  }

  /**
   * Resolves when the prompt is pasted, or after HANDOFF_MS if it is still
   * waiting for the agent; it stays queued either way. Rejects if it's dropped
   * before then; a later drop is reported through onDropped.
   */
  private deliver(comments: Comment[]): Promise<void> {
    if (this.options.session.current.state !== 'running') return Promise.reject(new Error('the terminal is not running'));
    const pasted = this.queue.enqueue(this.options.format(comments));
    return new Promise((resolve, reject) => {
      let handedOff = false;
      const timer = setTimeout(() => {
        handedOff = true;
        resolve();
      }, this.options.handoffMs ?? HANDOFF_MS);
      pasted.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: Error) => {
          clearTimeout(timer);
          if (handedOff) this.options.onDropped(comments, error.message);
          else reject(error);
        },
      );
    });
  }
}

function describeStop(status: PtyStatus): string {
  if (status.state === 'starting') return 'the terminal restarted';
  if (status.state === 'disabled') return 'the terminal is disabled';
  return `the terminal exited (code ${status.exitCode ?? 'none'})`;
}
