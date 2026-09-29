import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Comment } from '../../shared/protocol.js';
import { TargetRegistry } from '../comments/targets.js';
import { isBatchTarget } from '../delivery/batch.js';
import { bracketedPaste } from './paste.js';
import { PtySession } from './session.js';
import { TERMINAL_TARGET, TerminalDelivery } from './target.js';
import { fakePtyLoader } from './testing.js';

const comment = (id: string, text: string) => ({ id, text }) as Comment;

async function setup(handoffMs = 5000) {
  const fake = fakePtyLoader();
  const session = new PtySession({ command: 'claude', cwd: '/p', env: {}, load: fake.load });
  const registry = new TargetRegistry();
  const dropped: { ids: string[]; reason: string }[] = [];
  const delivery = new TerminalDelivery({
    session,
    registry,
    format: (comments) => comments.map((c) => `[${c.id}] ${c.text}`).join('\n'),
    onDropped: (comments, reason) => dropped.push({ ids: comments.map((c) => c.id), reason }),
    handoffMs,
  });
  session.attach({ output() {}, control() {} });
  await vi.advanceTimersByTimeAsync(0);
  return { session, registry, delivery, dropped, pty: () => fake.spawned.at(-1)! };
}

describe('TerminalDelivery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('registers `terminal` only while the pty runs', async () => {
    const { session, registry, pty } = await setup();
    expect(registry.list()).toEqual([{ name: TERMINAL_TARGET, kind: 'terminal' }]);
    expect(isBatchTarget(registry.get(TERMINAL_TARGET)!)).toBe(true);
    pty().exit(0);
    expect(registry.list()).toEqual([]);
    await session.restart();
    expect(registry.list()).toEqual([{ name: TERMINAL_TARGET, kind: 'terminal' }]);
  });

  it('pastes the formatted prompt once the agent is quiet, then presses Enter', async () => {
    const { registry, pty } = await setup();
    const sent = registry.get(TERMINAL_TARGET)!.send(comment('c_1', 'bigger heading'));
    await vi.advanceTimersByTimeAsync(1600);
    await expect(sent).resolves.toBeUndefined();
    expect(pty().written).toEqual([bracketedPaste('[c_1] bigger heading'), '\r']);
  });

  it('a comment sent mid-response waits for the response to finish and is not interleaved', async () => {
    const { registry, pty } = await setup();
    const target = registry.get(TERMINAL_TARGET)!;
    pty().emit('\x1b]9;4;3;\x07thinking');
    const a = target.send(comment('c_a', 'first'));
    const b = target.send(comment('c_b', 'second'));
    for (let t = 0; t < 4000; t += 100) {
      pty().emit('.');
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(pty().written).toEqual([]);
    // Handed off after 5 s even though still waiting: stays under the service's 10 s timeout.
    await vi.advanceTimersByTimeAsync(1000);
    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBeUndefined();
    expect(pty().written).toEqual([]);

    pty().emit('done\x1b]9;4;0;\x07');
    await vi.advanceTimersByTimeAsync(1550);
    expect(pty().written).toEqual([bracketedPaste('[c_a] first'), '\r']);
    pty().emit('answering first...');
    await vi.advanceTimersByTimeAsync(1550);
    expect(pty().written).toEqual([bracketedPaste('[c_a] first'), '\r', bracketedPaste('[c_b] second'), '\r']);
  });

  it('sendBatch pastes several comments as one prompt', async () => {
    const { registry, pty } = await setup();
    const target = registry.get(TERMINAL_TARGET)!;
    if (!isBatchTarget(target)) throw new Error('not a batch target');
    const sent = target.sendBatch([comment('c_1', 'one'), comment('c_2', 'two')]);
    await vi.advanceTimersByTimeAsync(1600);
    await sent;
    expect(pty().written).toEqual([bracketedPaste('[c_1] one\n[c_2] two'), '\r']);
  });

  it('rejects a delivery dropped before hand-off, and reports one dropped after it', async () => {
    const { registry, dropped, pty } = await setup(1000);
    const target = registry.get(TERMINAL_TARGET)!;
    pty().emit('\x1b]9;4;3;\x07');
    const late = target.send(comment('c_late', 'handed off, then lost'));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(late).resolves.toBeUndefined();
    const early = target.send(comment('c_early', 'lost before hand-off'));
    const earlyResult = expect(early).rejects.toThrow(/exited \(code 1\) before the comment was pasted/);
    pty().exit(1);
    await earlyResult;
    expect(dropped).toEqual([{ ids: ['c_late'], reason: 'the terminal exited (code 1) before the comment was pasted' }]);
    expect(pty().written).toEqual([]);
  });

  it('drops pending deliveries on restart instead of pasting them into the new session', async () => {
    const { session, registry, pty } = await setup();
    const first = pty();
    first.emit('\x1b]9;4;3;\x07');
    const sent = registry.get(TERMINAL_TARGET)!.send(comment('c_1', 'x'));
    const result = expect(sent).rejects.toThrow(/restarted/);
    await session.restart();
    await result;
    await vi.advanceTimersByTimeAsync(5000);
    expect(pty()).not.toBe(first);
    expect(pty().written).toEqual([]);
  });
});
