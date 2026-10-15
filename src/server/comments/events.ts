// WS PREFIX/events: pushes every ServerEvent to every open shell and overlay.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerEvent } from '../../shared/protocol.js';

export class EventHub {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });

  /** `greeting` builds events sent to each new client, e.g. the current targets. */
  constructor(private greeting: () => ServerEvent[] = () => []) {
    this.wss.on('connection', (ws) => {
      // Clients only listen; ignore anything they send.
      ws.on('error', () => ws.terminate());
      for (const event of this.greeting()) ws.send(JSON.stringify(event));
    });
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
  }

  broadcast(event: ServerEvent): void {
    const text = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(text);
    }
  }

  get size(): number {
    return this.wss.clients.size;
  }

  close(): Promise<void> {
    for (const client of this.wss.clients) client.terminate();
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }
}
