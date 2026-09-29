// WS /pty end to end: a real pty (node-pty) running bash as a fake agent,
// through the galley server's security checks.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { PtyServerMessage, PtyStatus } from '../../shared/pty.js';
import { TargetRegistry } from '../comments/targets.js';
import { createGalleyServer, type GalleyServer } from '../index.js';
import { tokenCookieName } from '../security.js';
import type { GalleyContext } from '../types.js';
import { createPtyModule, type PtyModule } from './index.js';
import { loadPty } from './native.js';

const PORT = 5339;
const TOKEN = 'pty-test-token';
const available = (await loadPty()).ok;

class Client {
  readonly ws: WebSocket;
  output = '';
  statuses: PtyStatus[] = [];
  resets = 0;

  constructor(query = 'cols=100&rows=30', headers: Record<string, string> = {}) {
    this.ws = new WebSocket(`ws://localhost:${PORT}/__galley/pty?${query}`, {
      headers: { cookie: `${tokenCookieName(PORT)}=${TOKEN}`, origin: `http://localhost:${PORT}`, ...headers },
    });
    this.ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.output += data.toString();
        return;
      }
      const message = JSON.parse(data.toString()) as PtyServerMessage;
      if (message.type === 'reset') {
        this.resets++;
        this.output = '';
      } else this.statuses.push(message.status);
    });
  }

  get status(): PtyStatus | undefined {
    return this.statuses.at(-1);
  }

  type(text: string): void {
    this.ws.send(Buffer.from(text), { binary: true });
  }

  control(message: object): void {
    this.ws.send(JSON.stringify(message));
  }

  async until(predicate: () => boolean, what: string, ms = 5000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; output: ${JSON.stringify(this.output.slice(-400))}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

describe.skipIf(!available)('WS /pty with a real pty', () => {
  let galley: GalleyServer;
  let pty: PtyModule;
  const registry = new TargetRegistry();

  beforeAll(async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'galley-pty-'));
    const ctx: GalleyContext = {
      cwd,
      dataDir: join(cwd, '.galley'),
      port: PORT,
      target: new URL('http://localhost:1'),
      token: TOKEN,
      agent: 'bash --norc --noprofile',
    };
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: cwd, TERM: 'xterm-256color', PS1: 'fake-agent$ ' };
    pty = createPtyModule({ registry, env, cli: 'galley' });
    galley = createGalleyServer({ ctx, modules: [pty], clientDir: cwd });
    await galley.listen();
  });

  afterAll(async () => {
    await galley.close();
  });

  it('refuses a socket without the token', async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/__galley/pty`);
    const status = await new Promise<number>((resolve) => ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0)));
    expect(status).toBe(401);
  });

  it('runs one session that survives reconnects, replays scrollback, and restarts with a new pid', async () => {
    const a = new Client();
    await a.until(() => a.status?.state === 'running', 'running');
    const pid = a.status!.pid!;
    expect(pty.session?.pid).toBe(pid);
    expect(registry.list()).toEqual([{ name: 'terminal', kind: 'terminal' }]);

    a.type('echo "pid=$$ sum=$((40+2))"\r');
    await a.until(() => a.output.includes('sum=42'), 'echo output');
    expect(a.output).toContain(`pid=${pid}`);
    await a.close();

    // A "reload": a new viewer gets the history and the same process.
    const b = new Client('cols=80&rows=24');
    await b.until(() => b.output.includes('sum=42'), 'scrollback replay');
    expect(b.status).toMatchObject({ state: 'running', pid });
    expect(b.resets).toBe(1);
    b.type('stty size\r');
    await b.until(() => b.output.includes('24 80'), 'stty size reflects the new viewer');

    b.control({ type: 'resize', cols: 132, rows: 43 });
    b.type('stty size\r');
    await b.until(() => b.output.includes('43 132'), 'resize');

    b.control({ type: 'restart' });
    await b.until(() => b.status?.state === 'running' && b.status.pid !== pid, 'restart');
    expect(b.resets).toBe(2);
    b.type('echo "new=$$"\r');
    await b.until(() => b.output.includes(`new=${b.status!.pid}`), 'new process output');
    expect(b.output).not.toContain('sum=42');

    b.type('exit 7\r');
    await b.until(() => b.status?.state === 'exited', 'exit');
    expect(b.status).toMatchObject({ state: 'exited', exitCode: 7 });
    expect(registry.list()).toEqual([]);
    await b.close();
  });
});
