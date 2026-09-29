// The one terminal session per galley process: the agent running in a pty,
// its scrollback, and the viewers (browser drawers) attached to it. It starts
// on the first attach and keeps running when viewers come and go.
import type { PtyServerMessage, PtyStatus } from '../../shared/pty.js';
import { agentEnv, parseAgentCommand } from './command.js';
import { loadPty, type PtyLoad, type PtyProcess } from './native.js';
import { stripTerminalQueries } from './queries.js';
import { RingBuffer, SCROLLBACK_BYTES } from './ring.js';

export interface Viewer {
  output(data: string): void;
  control(message: PtyServerMessage): void;
}

export interface SessionOptions {
  /** The --agent command line. */
  command: string;
  cwd: string;
  env?: Record<string, string>;
  load?: () => Promise<PtyLoad>;
  scrollbackBytes?: number;
  /** How long a killed process gets to exit before SIGKILL. */
  killGraceMs?: number;
}

const DEFAULT_SIZE = { cols: 100, rows: 30 };

export class PtySession {
  private status: PtyStatus;
  private proc: PtyProcess | undefined;
  private startup: Promise<void> | undefined;
  private readonly ring: RingBuffer;
  private readonly viewers = new Set<Viewer>();
  private readonly statusListeners = new Set<(status: PtyStatus) => void>();
  private readonly outputListeners = new Set<(data: string) => void>();
  private size = { ...DEFAULT_SIZE };
  private closed = false;

  constructor(private readonly options: SessionOptions) {
    this.status = { state: 'starting', command: options.command };
    this.ring = new RingBuffer(options.scrollbackBytes ?? SCROLLBACK_BYTES);
  }

  get current(): PtyStatus {
    return this.status;
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  /** Adds a viewer: sends status and the scrollback, and starts the agent if it isn't running yet. */
  attach(viewer: Viewer, size?: { cols: number; rows: number }): () => void {
    this.viewers.add(viewer);
    if (size) this.resize(size.cols, size.rows);
    viewer.control({ type: 'status', status: this.status });
    viewer.control({ type: 'reset' });
    const scrollback = this.ring.contents();
    if (scrollback) viewer.output(scrollback);
    if (!this.proc && this.status.state === 'starting') void this.start();
    return () => this.viewers.delete(viewer);
  }

  input(data: string): void {
    if (this.status.state === 'running') this.proc?.write(data);
  }

  /** The last viewer to resize wins. */
  resize(cols: number, rows: number): void {
    this.size = { cols, rows };
    try {
      this.proc?.resize(cols, rows);
    } catch {
      // The process may have just exited; the size applies to the next one.
    }
  }

  /** Kills the current process, if any, clears the scrollback and spawns a fresh one. */
  async restart(): Promise<void> {
    if (this.closed || this.status.state === 'disabled') return;
    await this.startup;
    this.stopProcess();
    this.ring.clear();
    this.broadcast({ type: 'reset' });
    await this.start();
  }

  onStatus(listener: (status: PtyStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onOutput(listener: (data: string) => void): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.stopProcess();
    this.viewers.clear();
  }

  private start(): Promise<void> {
    this.startup ??= this.spawn().finally(() => {
      this.startup = undefined;
    });
    return this.startup;
  }

  private async spawn(): Promise<void> {
    const { command, cwd } = this.options;
    this.setStatus({ state: 'starting', command });

    const pty = await (this.options.load ?? loadPty)();
    if (this.closed) return;
    if (!pty.ok) return this.setStatus({ state: 'disabled', command, message: pty.message });

    let argv;
    try {
      argv = parseAgentCommand(command);
    } catch (error) {
      return this.setStatus({ state: 'disabled', command, message: errorMessage(error) });
    }

    let proc: PtyProcess;
    try {
      proc = pty.spawn(argv.file, argv.args, { cwd, env: this.options.env ?? agentEnv(), ...this.size });
    } catch (error) {
      const message = `could not start "${command}" in ${cwd}: ${errorMessage(error)}`;
      return this.setStatus({ state: 'exited', command, exitCode: null, message });
    }

    this.proc = proc;
    proc.onData((data) => {
      if (this.proc !== proc) return;
      this.ring.push(stripTerminalQueries(data));
      for (const viewer of this.viewers) viewer.output(data);
      for (const listener of this.outputListeners) listener(data);
    });
    proc.onExit(({ exitCode, signal }) => {
      if (this.proc !== proc) return;
      this.proc = undefined;
      this.setStatus({ state: 'exited', command, exitCode, ...(signal ? { signal } : {}) });
    });
    this.setStatus({ state: 'running', command, pid: proc.pid });
  }

  // Detaches first so the old process's exit can't overwrite the new status.
  private stopProcess(): void {
    const proc = this.proc;
    if (!proc) return;
    this.proc = undefined;
    let exited = false;
    proc.onExit(() => {
      exited = true;
    });
    try {
      proc.kill();
    } catch {
      return;
    }
    const escalate = setTimeout(() => {
      if (exited) return;
      try {
        proc.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }, this.options.killGraceMs ?? 2000);
    escalate.unref();
  }

  private setStatus(status: PtyStatus): void {
    this.status = status;
    this.broadcast({ type: 'status', status });
    for (const listener of this.statusListeners) listener(status);
  }

  private broadcast(message: PtyServerMessage): void {
    for (const viewer of this.viewers) viewer.control(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
