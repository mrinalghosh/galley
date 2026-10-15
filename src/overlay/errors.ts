// Console capture: uncaught errors and unhandled rejections on the site page,
// kept in a small ring so a comment can carry them. Installed when the overlay
// script starts (in <head>), before the site's own code runs.
import { PREFIX } from '../shared/constants.js';
import type { CapturedError } from '../shared/protocol.js';

export const MAX_CAPTURED_ERRORS = 20;

type Listener = (errors: CapturedError[]) => void;

/** The most recent errors, oldest first, capped at `max`. */
export class ErrorRing {
  private items: CapturedError[] = [];
  private listeners = new Set<Listener>();

  constructor(private readonly max = MAX_CAPTURED_ERRORS) {}

  get size(): number {
    return this.items.length;
  }

  list(): CapturedError[] {
    return this.items.slice();
  }

  push(error: CapturedError): void {
    this.items = [...this.items, error].slice(-this.max);
    this.changed();
  }

  clear(): void {
    if (this.items.length === 0) return;
    this.items = [];
    this.changed();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    const snapshot = this.list();
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** Where overlay.js is served from; errors whose stack or file points here are ours. */
const OWN_SCRIPT = `${PREFIX}/overlay.js`;

/** The fields of an ErrorEvent we use, so tests can pass plain objects. */
export interface ErrorEventLike {
  message?: string;
  error?: unknown;
  filename?: string;
  lineno?: number;
  colno?: number;
}

/** Turns a window `error` event into an entry, or undefined when the overlay itself threw. */
export function fromErrorEvent(event: ErrorEventLike, at = new Date()): CapturedError | undefined {
  const { error } = event;
  const stack = error instanceof Error && error.stack ? error.stack : sourceLocation(event);
  if (isOwn(event.filename) || isOwn(stack)) return undefined;
  const message = error instanceof Error ? describe(error) : event.message || String(error ?? 'Unknown error');
  return withStack({ message, at: at.toISOString() }, stack);
}

/** Turns an unhandled rejection's reason into an entry, or undefined when it came from the overlay. */
export function fromRejection(reason: unknown, at = new Date()): CapturedError | undefined {
  const stack = reason instanceof Error ? reason.stack : undefined;
  if (isOwn(stack)) return undefined;
  const detail = reason instanceof Error ? describe(reason) : stringify(reason);
  // Without an Error there is no stack; the string form is the best we have.
  return withStack({ message: `Unhandled promise rejection: ${detail}`, at: at.toISOString() }, stack ?? detail);
}

/**
 * Listens for uncaught errors and unhandled rejections on `win` and records
 * them in `ring`. Returns a function that removes the listeners.
 */
export function captureErrors(win: Window, ring: ErrorRing): () => void {
  const onError = (event: ErrorEvent) => record(ring, fromErrorEvent(event));
  const onRejection = (event: PromiseRejectionEvent) => record(ring, fromRejection(event.reason));
  // Bubble phase only: resource load failures (img, script) don't bubble to window.
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection);
  return () => {
    win.removeEventListener('error', onError);
    win.removeEventListener('unhandledrejection', onRejection);
  };
}

function record(ring: ErrorRing, entry: CapturedError | undefined): void {
  if (entry) ring.push(entry);
}

function isOwn(text: string | undefined): boolean {
  return Boolean(text?.includes(OWN_SCRIPT));
}

/** "TypeError: x is undefined", keeping the error's type. */
function describe(error: Error): string {
  return error.message ? `${error.name || 'Error'}: ${error.message}` : error.name || 'Error';
}

function sourceLocation({ filename, lineno, colno }: ErrorEventLike): string | undefined {
  return filename ? `at ${filename}:${lineno ?? 0}:${colno ?? 0}` : undefined;
}

function withStack(entry: CapturedError, stack: string | undefined): CapturedError {
  return stack ? { ...entry, stack } : entry;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
