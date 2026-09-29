// Writing prompts into the terminal. Deliveries go out one at a time, each as
// a bracketed paste followed by Enter, and (when gated) only once the agent
// is idle and waiting for input.
import { abortError } from './activity.js';

export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';
export const SUBMIT_DELAY_MS = 50;

/** Decides when the agent may receive the next delivery. */
export interface DeliveryGate {
  waitForIdle(signal: AbortSignal): Promise<void>;
  /** Counts our own submit as activity, so the next delivery waits a full quiet period after it. */
  touch(): void;
}

/**
 * Wraps text as one bracketed paste. ESC and other control characters are
 * removed so the text can't end the paste early or inject key sequences;
 * newlines and tabs stay.
 */
export function bracketedPaste(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  return `${PASTE_START}${clean}${PASTE_END}`;
}

export interface PasteQueueOptions {
  write(data: string): void;
  /** When set, each delivery first waits for the gate. */
  gate?: DeliveryGate;
  submitDelayMs?: number;
}

interface Job {
  text: string;
  resolve(): void;
  reject(error: Error): void;
}

/**
 * Serializes deliveries: a paste and its Enter are always written together,
 * never interleaved with another delivery. enqueue() resolves when the prompt
 * has been written and submitted.
 */
export class PasteQueue {
  private jobs: Job[] = [];
  private running = false;
  private abort = new AbortController();

  constructor(private readonly options: PasteQueueOptions) {}

  get pending(): number {
    return this.jobs.length + (this.running ? 1 : 0);
  }

  enqueue(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.jobs.push({ text, resolve, reject });
      void this.drain();
    });
  }

  /** Rejects every waiting delivery, e.g. when the pty exits. */
  cancel(reason: string): void {
    this.abort.abort(new Error(reason));
    this.abort = new AbortController();
    for (const job of this.jobs.splice(0)) job.reject(new Error(reason));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.jobs.shift(); job; job = this.jobs.shift()) {
        try {
          await this.deliver(job.text, this.abort.signal);
          job.resolve();
        } catch (error) {
          job.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async deliver(text: string, signal: AbortSignal): Promise<void> {
    const { write, gate, submitDelayMs = SUBMIT_DELAY_MS } = this.options;
    if (gate) await gate.waitForIdle(signal);
    write(bracketedPaste(text));
    await delay(submitDelayMs, signal);
    write('\r');
    gate?.touch();
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError(signal));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
