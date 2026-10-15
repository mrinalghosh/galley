// The drawer's socket to WS PREFIX/pty, reconnecting with backoff. The server
// replays its scrollback after every (re)connect, preceded by a reset.
import { PREFIX } from '../../shared/constants.js';
import { isPtyServerMessage, type PtyClientMessage, type PtyServerMessage, PTY_PATH } from '../../shared/pty.js';

export interface ConnectionHandlers {
  output(data: Uint8Array): void;
  message(message: PtyServerMessage): void;
  /** The socket opened (true) or dropped and is waiting to retry (false). */
  connected(open: boolean): void;
}

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

export class PtyConnection {
  private ws: WebSocket | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private backoff = MIN_BACKOFF_MS;
  private closed = false;
  private readonly encoder = new TextEncoder();

  constructor(
    private readonly handlers: ConnectionHandlers,
    private readonly size: () => { cols: number; rows: number },
  ) {
    this.open();
  }

  sendInput(data: string): void {
    this.sendRaw(this.encoder.encode(data));
  }

  /** xterm's onBinary: one byte per char code (e.g. legacy mouse reports). */
  sendBinary(data: string): void {
    this.sendRaw(Uint8Array.from(data, (ch) => ch.charCodeAt(0) & 0xff));
  }

  send(message: PtyClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retry);
    this.ws?.close();
  }

  private sendRaw(bytes: Uint8Array<ArrayBuffer>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(bytes);
  }

  private open(): void {
    const { cols, rows } = this.size();
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}${PREFIX}${PTY_PATH}?cols=${cols}&rows=${rows}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = MIN_BACKOFF_MS;
      this.handlers.connected(true);
    };
    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) return this.handlers.output(new Uint8Array(event.data));
      const message = parse(String(event.data));
      if (message) this.handlers.message(message);
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      this.handlers.connected(false);
      this.retry = setTimeout(() => this.open(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    };
  }
}

function parse(text: string): PtyServerMessage | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isPtyServerMessage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
