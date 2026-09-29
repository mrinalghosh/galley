import { useState } from 'preact/hooks';
import type { NewComment } from '../../shared/protocol.js';
import { anchorFor, clamp } from '../geometry.js';

const PIN = 22;

/** A comment waiting in the batch tray. Lives in memory only. */
export interface BatchItem {
  key: string;
  comment: NewComment;
}

/** One id shared by every comment sent together, e.g. b_m3x9k2a7f4q. */
export function newBatchId(): string {
  return `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

interface TrayProps {
  items: BatchItem[];
  target: string;
  /** What happened to the last batch, when it needs saying (e.g. it stayed queued). */
  notice?: string;
  onRemove(key: string): void;
  onClear(): void;
  onSend(): Promise<void>;
}

/** The batch: comments collected with "Add to batch", sent together as one prompt. */
export function BatchTray({ items, target, notice, onRemove, onClear, onSend }: TrayProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const send = async () => {
    setSending(true);
    setError(undefined);
    try {
      await onSend();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const destination = target === 'queue' ? 'the queue' : target;
  return (
    <aside class="tray" data-galley="batch" onKeyDown={(event) => event.stopPropagation()}>
      <header class="panel-head">
        <strong>
          Batch <span class="count">{items.length}</span>
        </strong>
        <button type="button" class="icon-button" aria-label="Close the batch" title={items.length ? 'Discard the batch' : 'Close'} onClick={onClear}>
          ×
        </button>
      </header>
      <ol class="tray-list">
        {items.map((item, i) => (
          <li key={item.key} class="tray-item" data-galley="batch-item">
            <span class="badge badge-batch">B{i + 1}</span>
            <span class="tray-text" title={item.comment.text}>
              {item.comment.text}
            </span>
            <button type="button" class="icon-button" aria-label={`Remove B${i + 1} from the batch`} onClick={() => onRemove(item.key)}>
              ×
            </button>
          </li>
        ))}
      </ol>
      {notice && <div class="tray-notice">{notice}</div>}
      {error && <div class="panel-error">{error}</div>}
      {items.length > 0 && (
        <footer class="tray-foot">
          <span class="muted">Kept in this tab only; a reload clears it.</span>
          <button
            type="button"
            class="button-primary"
            disabled={sending}
            data-galley="send-batch"
            title={`Send as one prompt to ${destination}`}
            onClick={send}
          >
            {sending ? 'Sending…' : 'Send batch'}
          </button>
        </footer>
      )}
    </aside>
  );
}

/** Dashed "B1, B2…" pins for batched comments on this page that point at elements. */
export function BatchPins({ items, url }: { items: BatchItem[]; url: string }) {
  const vw = window.innerWidth;
  return (
    <>
      {items.map((item, i) => {
        if (item.comment.url !== url || item.comment.elements.length === 0) return null;
        const { rect } = anchorFor(item.comment);
        const x = clamp(rect.x - PIN / 2, 2, vw - PIN - 2);
        const y = rect.y + rect.h > 0 ? Math.max(2, rect.y - PIN / 2) : rect.y - PIN / 2;
        return (
          <div
            key={item.key}
            class="pin pin-batch"
            style={{ transform: `translate(${x}px, ${y}px)` }}
            title={item.comment.text}
            data-galley="batch-pin"
          >
            B{i + 1}
          </div>
        );
      })}
    </>
  );
}
