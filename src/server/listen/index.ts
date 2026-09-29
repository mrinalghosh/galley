// Listening chats: WS PREFIX/listen?name=<name>. Each open socket is a delivery
// target; every text frame it receives is one prompt, which a Claude Code
// Monitor turns into one chat notification. So nothing else is ever sent as
// text: liveness uses ping/pong control frames.
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { Comment } from '../../shared/protocol.js';
import { type CommentService, commentsModule } from '../comments/index.js';
import { type TargetRegistry, targets as defaultRegistry } from '../comments/targets.js';
import type { BatchDeliveryTarget } from '../delivery/batch.js';
import { resolveCliCommand } from '../delivery/cli.js';
import { flushQueue } from '../delivery/flush.js';
import { formatPrompt, type PromptContext } from '../delivery/prompt.js';
import type { GalleyContext, GalleyModule } from '../types.js';
import { validateListenerName } from './name.js';

export { RESERVED_NAMES, validateListenerName } from './name.js';

export const PING_INTERVAL_MS = 30_000;

export interface ListenOptions {
  registry?: TargetRegistry;
  pingIntervalMs?: number;
  /** Overrides the CLI invocation used in done/fail commands (tests). */
  cli?: string;
  /** Used to catch up on comments queued for this name while it was away. */
  getService?: () => CommentService | undefined;
}

export interface ListenModule extends GalleyModule {
  /** Names of the open listener sockets. */
  names(): string[];
}

export function createListenModule(options: ListenOptions = {}): ListenModule {
  const registry = options.registry ?? defaultRegistry;
  const getService = options.getService ?? (() => commentsModule.service);
  // Frames from a listener are ignored, so keep them tiny.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const sockets = new Map<string, WebSocket>();
  const alive = new WeakMap<WebSocket, boolean>();
  let prompt: PromptContext | undefined;
  let pinger: NodeJS.Timeout | undefined;

  function attach(ws: WebSocket, name: string, ctx: PromptContext): void {
    sockets.set(name, ws);
    alive.set(ws, true);
    const format = (comments: Comment[]) => formatPrompt(comments, ctx);
    const target: BatchDeliveryTarget = {
      name,
      kind: 'listener',
      send: (comment) => sendText(ws, format([comment])),
      sendBatch: (comments) => sendText(ws, format(comments)),
    };
    // The returned function only removes this exact target, never a successor.
    const unregister = registry.register(target);

    ws.on('pong', () => alive.set(ws, true));
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      unregister();
      if (sockets.get(name) === ws) sockets.delete(name);
    });
    catchUp(name);
  }

  // A Monitor re-arming leaves a short gap; comments addressed to this name in
  // that gap were queued under it. Deliver them now, as one prompt.
  function catchUp(name: string): void {
    const service = getService();
    if (!service) return;
    const ids = service.store
      .list()
      .filter((c) => c.status === 'queued' && c.target === name)
      .map((c) => c.id);
    if (ids.length) flushQueue(service, name, ids).catch(() => {});
  }

  function pingAll(): void {
    for (const ws of sockets.values()) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }

  return {
    name: 'listen',

    init(ctx: GalleyContext) {
      prompt = { cli: options.cli ?? resolveCliCommand(), cwd: ctx.cwd, origin: `http://localhost:${ctx.port}` };
      pinger = setInterval(pingAll, options.pingIntervalMs ?? PING_INTERVAL_MS);
      pinger.unref();
    },

    upgrade(req, socket, head, path) {
      if (path !== '/listen') return false;
      if (!prompt) return rejectUpgrade(socket, 503, 'galley is starting');
      const result = validateListenerName(new URL(req.url ?? '/', 'http://galley.invalid').searchParams.get('name'));
      if (!result.ok) return rejectUpgrade(socket, 400, result.error);
      // Refuse rather than replace a live listener: two chats that picked the
      // same name would otherwise keep kicking each other off as they re-arm.
      const existing = sockets.get(result.name);
      if (existing?.readyState === WebSocket.OPEN) {
        return rejectUpgrade(socket, 409, `a listener named "${result.name}" is already connected; pick another name`);
      }
      const ctx = prompt;
      wss.handleUpgrade(req, socket, head, (ws) => attach(ws, result.name, ctx));
      return true;
    },

    names() {
      return [...sockets.keys()];
    },

    async close() {
      clearInterval(pinger);
      for (const ws of sockets.values()) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

function sendText(ws: WebSocket, text: string): Promise<void> {
  if (ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('listener disconnected'));
  return new Promise((resolve, reject) => ws.send(text, (err) => (err ? reject(err) : resolve())));
}

const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 409: 'Conflict', 503: 'Service Unavailable' };

/** Answers an upgrade with a plain HTTP error. Returns true: the request is handled. */
function rejectUpgrade(socket: Duplex, status: number, reason: string): true {
  const body = `galley: ${reason}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n` +
      body,
  );
  return true;
}

export const listenModule = createListenModule();
