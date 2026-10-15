// Test doubles for the pty: a scriptable process and a loader that records spawns.
import type { PtyLoad, PtyProcess, SpawnOptions } from './native.js';

type Listener<T> = (value: T) => void;

let nextPid = 1000;

export class FakePty implements PtyProcess {
  readonly pid = nextPid++;
  readonly written: string[] = [];
  readonly signals: (string | undefined)[] = [];
  cols: number;
  rows: number;
  private dataListeners = new Set<Listener<string>>();
  private exitListeners = new Set<Listener<{ exitCode: number; signal?: number }>>();

  constructor(
    readonly file: string,
    readonly args: string[],
    readonly options: SpawnOptions,
  ) {
    this.cols = options.cols;
    this.rows = options.rows;
  }

  onData(listener: Listener<string>) {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener: Listener<{ exitCode: number; signal?: number }>) {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  write(data: string): void {
    this.written.push(data);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }

  kill(signal?: string): void {
    this.signals.push(signal);
    this.exit(0, 1);
  }

  /** Simulates output from the process. */
  emit(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  exit(exitCode: number, signal?: number): void {
    for (const listener of [...this.exitListeners]) listener({ exitCode, signal });
    this.exitListeners.clear();
  }
}

export function fakePtyLoader(): { load: () => Promise<PtyLoad>; spawned: FakePty[] } {
  const spawned: FakePty[] = [];
  const load = async (): Promise<PtyLoad> => ({
    ok: true,
    spawn: (file, args, options) => {
      const pty = new FakePty(file, args, options);
      spawned.push(pty);
      return pty;
    },
  });
  return { load, spawned };
}
