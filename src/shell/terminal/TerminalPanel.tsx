// The browser terminal, mounted in the drawer's #galley-terminal. xterm.js
// renders the one agent session the server runs; closing the drawer or
// reloading the page only detaches this viewer.
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PtyStatus } from '../../shared/pty.js';
import { PtyConnection } from './connection.js';
import { fontFamily, injectTerminalStyles, theme } from './styles.js';

export function TerminalPanel() {
  const screen = useRef<HTMLDivElement>(null);
  const connection = useRef<PtyConnection | null>(null);
  const [status, setStatus] = useState<PtyStatus | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const host = screen.current;
    if (!host) return;
    injectTerminalStyles();

    const term = new Terminal({ theme, fontFamily, fontSize: 12, lineHeight: 1.15, cursorBlink: true, scrollback: 5000 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    const refit = () => {
      // Skip while hidden (zero size): fitting would shrink the pty to nothing.
      if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
    };
    refit();

    const conn = new PtyConnection(
      {
        output: (data) => term.write(data),
        message: (message) => (message.type === 'reset' ? term.reset() : setStatus(message.status)),
        connected: setConnected,
      },
      () => ({ cols: term.cols, rows: term.rows }),
    );
    connection.current = conn;
    const subscriptions = [
      term.onData((data) => conn.sendInput(data)),
      term.onBinary((data) => conn.sendBinary(data)),
      term.onResize(({ cols, rows }) => conn.send({ type: 'resize', cols, rows })),
    ];

    const observer = new ResizeObserver(refit);
    observer.observe(host);
    term.focus();

    return () => {
      observer.disconnect();
      for (const subscription of subscriptions) subscription.dispose();
      conn.close();
      connection.current = null;
      term.dispose();
    };
  }, []);

  const restart = () => {
    if (status?.state === 'running' && !confirm(`Restart ${status.command}? The current session ends.`)) return;
    connection.current?.send({ type: 'restart' });
  };

  const canRestart = connected && (status?.state === 'running' || status?.state === 'exited');
  return (
    // Keys typed here belong to the terminal, not the shell's tool hotkeys (C, L, Esc).
    <div class="g-term" onKeyDown={(event) => event.stopPropagation()}>
      <div class="g-term-bar">
        <span class="g-term-state" data-state={connected ? (status?.state ?? 'connecting') : 'connecting'} title={status?.message}>
          <span class="g-term-dot" />
          <span class="g-term-label">{describe(status, connected)}</span>
        </span>
        <button class="g-btn g-term-restart" title="Kill and restart the agent" disabled={!canRestart} onClick={restart}>
          Restart
        </button>
      </div>
      <div class="g-term-screen">
        <div class="g-term-xterm" ref={screen} />
        {connected && status?.state === 'exited' && (
          <div class="g-term-note" data-kind="exited">
            <p>{status.message ?? `${status.command} exited${status.exitCode == null ? '' : ` with code ${status.exitCode}`}.`}</p>
            <button class="g-btn g-term-restart" onClick={restart}>
              Restart
            </button>
          </div>
        )}
        {connected && status?.state === 'disabled' && (
          <div class="g-term-note" data-kind="disabled">
            <p>Terminal disabled: {status.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function describe(status: PtyStatus | null, connected: boolean): string {
  if (!connected) return status ? 'reconnecting…' : 'connecting…';
  if (!status) return 'connecting…';
  switch (status.state) {
    case 'starting':
      return `starting ${status.command}…`;
    case 'running':
      return `running · ${status.command}${status.pid ? ` · pid ${status.pid}` : ''}`;
    case 'exited':
      return `exited (${status.exitCode ?? (status.signal ? `signal ${status.signal}` : 'no code')})`;
    case 'disabled':
      return 'disabled';
  }
}
