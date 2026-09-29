import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityMonitor } from './activity.js';

const BUSY = '\x1b]9;4;3;\x07';
const IDLE = '\x1b]9;4;0;\x07';

describe('ActivityMonitor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is idle only after quietMs without output', () => {
    const monitor = new ActivityMonitor(1500);
    expect(monitor.isIdle()).toBe(false);
    vi.advanceTimersByTime(1499);
    expect(monitor.isIdle()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(monitor.isIdle()).toBe(true);
    monitor.observe('spinner');
    expect(monitor.isIdle()).toBe(false);
  });

  it('waitForIdle resolves after output stops, however long it keeps coming', async () => {
    const monitor = new ActivityMonitor(1500);
    let idle = false;
    void monitor.waitForIdle().then(() => (idle = true));
    // Output every 200 ms for 10 s, like a spinner.
    for (let t = 0; t < 10_000; t += 200) {
      monitor.observe('.');
      await vi.advanceTimersByTimeAsync(200);
      expect(idle).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(1299);
    expect(idle).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(idle).toBe(true);
  });

  it('stays busy while the agent reports progress, even when quiet', async () => {
    const monitor = new ActivityMonitor(1500);
    monitor.observe(`title${BUSY}`);
    let idle = false;
    void monitor.waitForIdle().then(() => (idle = true));
    await vi.advanceTimersByTimeAsync(60_000); // e.g. a permission prompt waiting for the user
    expect(idle).toBe(false);
    monitor.observe(IDLE);
    await vi.advanceTimersByTimeAsync(1500);
    expect(idle).toBe(true);
  });

  it('parses progress sequences split across chunks, with BEL or ST', () => {
    const monitor = new ActivityMonitor(0);
    monitor.observe('abc\x1b]9;');
    monitor.observe('4;3;\x07');
    expect(monitor.reportedBusy).toBe(true);
    monitor.observe('x\x1b');
    monitor.observe(']9;4;0\x1b\\');
    expect(monitor.reportedBusy).toBe(false);
    monitor.observe(`${BUSY}later${IDLE}`);
    expect(monitor.reportedBusy).toBe(false);
    monitor.observe('\x1b]0;title\x07\x1b[?25h');
    expect(monitor.reportedBusy).toBe(false);
  });

  it('reset() forgets a busy report from the previous process', () => {
    const monitor = new ActivityMonitor(0);
    monitor.observe(BUSY);
    monitor.reset();
    expect(monitor.reportedBusy).toBe(false);
  });

  it('waitForIdle rejects when aborted', async () => {
    const monitor = new ActivityMonitor(1500);
    const abort = new AbortController();
    const waiting = monitor.waitForIdle(abort.signal);
    abort.abort(new Error('pty exited'));
    await expect(waiting).rejects.toThrow('pty exited');
  });
});

describe('ActivityMonitor and terminal queries', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('an idle agent polling the cursor position still counts as quiet', async () => {
    const monitor = new ActivityMonitor(1500);
    monitor.observe('\x1b]9;4;0;\x07❯ ');
    let idle = false;
    void monitor.waitForIdle().then(() => (idle = true));
    for (let t = 0; t < 1500; t += 150) {
      monitor.observe('\x1b[?6n');
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(idle).toBe(true);
  });
});
