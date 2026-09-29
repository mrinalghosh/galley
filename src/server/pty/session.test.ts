import { describe, expect, it } from 'vitest';
import type { PtyServerMessage, PtyStatus } from '../../shared/pty.js';
import { PtySession, type Viewer } from './session.js';
import { fakePtyLoader } from './testing.js';

function viewer() {
  const output: string[] = [];
  const messages: PtyServerMessage[] = [];
  const v: Viewer = { output: (d) => output.push(d), control: (m) => messages.push(m) };
  const statuses = () => messages.filter((m): m is { type: 'status'; status: PtyStatus } => m.type === 'status').map((m) => m.status);
  return { v, output, messages, statuses };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function session(command = 'claude --verbose') {
  const fake = fakePtyLoader();
  const s = new PtySession({ command, cwd: '/proj', env: { TERM: 'xterm-256color' }, load: fake.load, killGraceMs: 10 });
  return { s, spawned: fake.spawned };
}

describe('PtySession', () => {
  it('starts lazily on the first attach, in cwd, at the viewer size', async () => {
    const { s, spawned } = session();
    expect(spawned).toHaveLength(0);
    const a = viewer();
    s.attach(a.v, { cols: 120, rows: 40 });
    await tick();
    expect(spawned).toHaveLength(1);
    const pty = spawned[0]!;
    expect([pty.file, pty.args, pty.options.cwd, pty.cols, pty.rows]).toEqual(['claude', ['--verbose'], '/proj', 120, 40]);
    expect(a.statuses().map((st) => st.state)).toEqual(['starting', 'starting', 'running']);
    expect(s.current).toMatchObject({ state: 'running', pid: pty.pid, command: 'claude --verbose' });
  });

  it('streams output to every viewer and replays scrollback to a new one', async () => {
    const { s, spawned } = session();
    const a = viewer();
    s.attach(a.v);
    await tick();
    spawned[0]!.emit('hello ');
    spawned[0]!.emit('world');
    expect(a.output.join('')).toBe('hello world');

    const b = viewer();
    s.attach(b.v);
    expect(b.messages[0]).toMatchObject({ type: 'status', status: { state: 'running' } });
    expect(b.messages[1]).toEqual({ type: 'reset' });
    expect(b.output).toEqual(['hello world']);
    expect(spawned).toHaveLength(1); // same process
  });

  it('outlives its viewers', async () => {
    const { s, spawned } = session();
    const detach = s.attach(viewer().v);
    await tick();
    detach();
    expect(s.viewerCount).toBe(0);
    spawned[0]!.emit('still running');
    const again = viewer();
    s.attach(again.v);
    expect(again.output).toEqual(['still running']);
    expect(spawned[0]!.signals).toEqual([]);
  });

  it('forwards input and lets the last viewer to resize set the size', async () => {
    const { s, spawned } = session();
    s.attach(viewer().v, { cols: 80, rows: 24 });
    await tick();
    s.attach(viewer().v, { cols: 200, rows: 50 });
    s.input('ls\r');
    expect(spawned[0]!.written).toEqual(['ls\r']);
    expect([spawned[0]!.cols, spawned[0]!.rows]).toEqual([200, 50]);
    s.resize(90, 30);
    expect([spawned[0]!.cols, spawned[0]!.rows]).toEqual([90, 30]);
  });

  it('reports exit and restarts with a new process and empty scrollback', async () => {
    const { s, spawned } = session();
    const a = viewer();
    s.attach(a.v);
    await tick();
    spawned[0]!.emit('old output');
    spawned[0]!.exit(3);
    expect(s.current).toMatchObject({ state: 'exited', exitCode: 3 });
    s.input('ignored');
    expect(spawned[0]!.written).toEqual([]);

    // Reattaching after an exit doesn't respawn by itself.
    s.attach(viewer().v);
    await tick();
    expect(spawned).toHaveLength(1);

    await s.restart();
    expect(spawned).toHaveLength(2);
    expect(spawned[1]!.pid).not.toBe(spawned[0]!.pid);
    expect(s.current).toMatchObject({ state: 'running', pid: spawned[1]!.pid });
    expect(a.messages.filter((m) => m.type === 'reset').length).toBe(2); // attach + restart
    const fresh = viewer();
    s.attach(fresh.v);
    expect(fresh.output).toEqual([]);
  });

  it('restart kills a running process, and its exit does not clobber the new status', async () => {
    const { s, spawned } = session();
    s.attach(viewer().v);
    await tick();
    await s.restart();
    expect(spawned[0]!.signals).toEqual([undefined]);
    expect(s.current).toMatchObject({ state: 'running', pid: spawned[1]!.pid });
  });

  it('is disabled with a message when node-pty cannot load', async () => {
    const s = new PtySession({ command: 'claude', cwd: '/p', load: async () => ({ ok: false, message: 'node-pty could not be loaded' }) });
    const a = viewer();
    s.attach(a.v);
    await tick();
    expect(s.current).toEqual({ state: 'disabled', command: 'claude', message: 'node-pty could not be loaded' });
    await s.restart();
    expect(s.current.state).toBe('disabled');
  });

  it('refuses permission-bypass flags', async () => {
    const { s, spawned } = session('claude --dangerously-skip-permissions');
    s.attach(viewer().v);
    await tick();
    expect(spawned).toHaveLength(0);
    expect(s.current).toMatchObject({ state: 'disabled', message: expect.stringMatching(/never bypasses/) });
  });

  it('reports a spawn failure as an exit with a message', async () => {
    const s = new PtySession({
      command: 'nope',
      cwd: '/p',
      load: async () => ({ ok: true, spawn: () => { throw new Error('posix_spawnp failed.'); } }),
    });
    s.attach(viewer().v);
    await tick();
    expect(s.current).toMatchObject({ state: 'exited', exitCode: null, message: expect.stringContaining('posix_spawnp failed') });
  });

  it('close() kills the process', async () => {
    const { s, spawned } = session();
    s.attach(viewer().v);
    await tick();
    s.close();
    expect(spawned[0]!.signals).toEqual([undefined]);
  });
});

describe('PtySession scrollback and terminal queries', () => {
  it('forwards queries live but keeps them out of the replay', async () => {
    const { s, spawned } = session();
    const live = viewer();
    s.attach(live.v);
    await tick();
    spawned[0]!.emit('prompt\x1b[?6n> ');
    expect(live.output).toEqual(['prompt\x1b[?6n> ']);
    const later = viewer();
    s.attach(later.v);
    expect(later.output).toEqual(['prompt> ']);
  });
});
