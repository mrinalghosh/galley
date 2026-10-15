// WS PREFIX/events client with capped exponential backoff.
import { PREFIX } from '../shared/constants.js';
import type { ServerEvent } from '../shared/protocol.js';

const MIN_DELAY = 500;
const MAX_DELAY = 10_000;

export interface EventStream {
  close(): void;
}

export interface EventHandlers {
  onEvent(event: ServerEvent): void;
  /** Runs on every (re)connect, so the caller can resync state it missed. */
  onOpen(): void;
  onClose(): void;
}

export function connectEvents({ onEvent, onOpen, onClose }: EventHandlers): EventStream {
  let socket: WebSocket | undefined;
  let delay = MIN_DELAY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const connect = () => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${scheme}://${location.host}${PREFIX}/events`);
    socket.onopen = () => {
      delay = MIN_DELAY;
      onOpen();
    };
    socket.onmessage = (message) => {
      try {
        onEvent(JSON.parse(String(message.data)) as ServerEvent);
      } catch {
        // Ignore malformed frames.
      }
    };
    socket.onclose = () => {
      if (closed) return;
      onClose();
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, MAX_DELAY);
    };
  };

  connect();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}
