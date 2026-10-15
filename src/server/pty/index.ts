// Browser terminal: WS PREFIX/pty attaches a drawer to the one agent session,
// and the `terminal` delivery target pastes comments into it. Protocol:
// src/shared/pty.ts.
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { Comment } from '../../shared/protocol.js';
import { clampSize, parsePtyClientMessage, PTY_LIMITS, PTY_PATH } from '../../shared/pty.js';
import { type CommentService, commentsModule } from '../comments/index.js';
import { type TargetRegistry, targets as defaultRegistry } from '../comments/targets.js';
import { resolveCliCommand } from '../delivery/cli.js';
import { formatPrompt, type PromptContext } from '../delivery/prompt.js';
import type { GalleyContext, GalleyModule } from '../types.js';
import type { PtyLoad } from './native.js';
import { PtySession, type Viewer } from './session.js';
import { TERMINAL_TARGET, TerminalDelivery } from './target.js';

export { TERMINAL_TARGET } from './target.js';

// Input frames are keystrokes and pastes; output to a viewer that falls this
// far behind is cut off, and it replays the scrollback when it reconnects.
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export interface PtyModuleOptions {
  registry?: TargetRegistry;
  getService?: () => CommentService | undefined;
  /** Replaces node-pty (tests). */
  load?: () => Promise<PtyLoad>;
  /** Replaces the agent's environment (tests). */
  env?: Record<string, string>;
  /** Wait for the agent to be idle before pasting. Default true. */
  gate?: boolean;
  cli?: string;
}

export interface PtyModule extends GalleyModule {
  /** Available after init(). */
  readonly session: PtySession | undefined;
  readonly delivery: TerminalDelivery | undefined;
}

export function createPtyModule(options: PtyModuleOptions = {}): PtyModule {
  const registry = options.registry ?? defaultRegistry;
  const getService = options.getService ?? (() => commentsModule.service);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_INPUT_BYTES });
  let session: PtySession | undefined;
  let delivery: TerminalDelivery | undefined;

  // A comment reported as sent whose paste never happened is marked failed,
  // unless something else (done, a resend) has changed it since.
  const onDropped = (comments: Comment[], reason: string) => {
    const service = getService();
    for (const comment of comments) {
      const current = service?.store.get(comment.id);
      if (current?.status === 'sent' && current.target === TERMINAL_TARGET) {
        service!.markFailed(comment.id, `delivery to ${TERMINAL_TARGET} failed: ${reason}`);
      }
    }
  };

  return {
    name: 'pty',
    get session() {
      return session;
    },
    get delivery() {
      return delivery;
    },

    init(ctx: GalleyContext) {
      session = new PtySession({ command: ctx.agent, cwd: ctx.cwd, load: options.load, env: options.env });
      const prompt: PromptContext = { cli: options.cli ?? resolveCliCommand(), cwd: ctx.cwd, origin: `http://localhost:${ctx.port}` };
      delivery = new TerminalDelivery({
        session,
        registry,
        format: (comments) => formatPrompt(comments, prompt),
        onDropped,
        gate: options.gate,
      });
    },

    upgrade(req, socket, head, path) {
      if (path !== PTY_PATH || !session) return false;
      const current = session;
      const size = requestedSize(req);
      wss.handleUpgrade(req, socket, head, (ws) => attachViewer(ws, current, size));
      return true;
    },

    async close() {
      delivery?.close();
      session?.close();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

function attachViewer(ws: WebSocket, session: PtySession, size: { cols: number; rows: number } | undefined): void {
  const viewer: Viewer = {
    output(data) {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return ws.terminate();
      ws.send(Buffer.from(data), { binary: true });
    },
    control(message) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    },
  };
  const detach = session.attach(viewer, size);

  ws.on('message', (data: RawData, isBinary: boolean) => {
    const text = rawToString(data);
    if (isBinary) return session.input(text);
    const message = parsePtyClientMessage(text);
    if (message?.type === 'resize') session.resize(message.cols, message.rows);
    else if (message?.type === 'restart') void session.restart();
  });
  ws.on('close', detach);
  ws.on('error', () => ws.terminate());
}

/** ?cols=&rows= on the upgrade URL, so a fresh session spawns at the viewer's size. */
function requestedSize(req: IncomingMessage): { cols: number; rows: number } | undefined {
  const params = new URL(req.url ?? '/', 'http://galley.invalid').searchParams;
  const cols = clampSize(params.get('cols'), PTY_LIMITS.MAX_COLS);
  const rows = clampSize(params.get('rows'), PTY_LIMITS.MAX_ROWS);
  return cols && rows ? { cols, rows } : undefined;
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data as ArrayBuffer).toString('utf8');
}

export const ptyModule = createPtyModule();
