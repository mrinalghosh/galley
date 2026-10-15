import { useEffect, useRef, useState } from 'preact/hooks';
import type { Rect } from '../../shared/protocol.js';
import { placeBeside } from '../geometry.js';

export const COMPOSER_WIDTH = 340;
const HEIGHT = 196;
const OPTION_HEIGHT = 26;

/** What the user chose besides the text. */
export interface ComposerChoice {
  /** The "attach errors" checkbox, when shown. */
  attachErrors: boolean;
}

interface Props {
  /** Viewport box around the selection. */
  anchor: Rect;
  summary: string;
  /** Prefilled text, e.g. for "Fix this error". */
  initialText?: string;
  /** Label for the attach-errors checkbox; no checkbox when undefined. */
  attachLabel?: string;
  targets: string[];
  target: string;
  onTarget(target: string): void;
  onSend(text: string, choice: ComposerChoice): Promise<void>;
  /** Adds the comment to the batch tray instead of sending it. */
  onBatch(text: string, choice: ComposerChoice): Promise<void>;
  onCancel(): void;
}

export function Composer({ anchor, summary, initialText = '', attachLabel, targets, target, onTarget, onSend, onBatch, onCancel }: Props) {
  const [text, setText] = useState(initialText);
  const [attachErrors, setAttachErrors] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Wait a frame so the click that opened us has finished moving focus.
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const submit = async (action: Props['onSend']) => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await action(text.trim(), { attachErrors: Boolean(attachLabel) && attachErrors });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Keys typed here belong to the composer, not to the site or our shortcuts.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit(event.shiftKey ? onBatch : onSend);
    }
  };

  const height = HEIGHT + (attachLabel ? OPTION_HEIGHT : 0);
  const { x, y } = placeBeside(anchor, COMPOSER_WIDTH, height);
  const empty = !text.trim();
  return (
    <form
      class="composer"
      style={{ transform: `translate(${x}px, ${y}px)`, width: `${COMPOSER_WIDTH}px` }}
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(onSend);
      }}
      data-galley="composer"
    >
      <div class="composer-summary" title={summary}>
        {summary}
      </div>
      <textarea
        ref={input}
        value={text}
        placeholder="What should change?"
        rows={4}
        onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
      />
      {attachLabel && (
        <label class="composer-option">
          <input
            type="checkbox"
            checked={attachErrors}
            data-galley="attach-errors"
            onChange={(event) => setAttachErrors((event.target as HTMLInputElement).checked)}
          />
          {attachLabel}
        </label>
      )}
      {error && <div class="composer-error">{error}</div>}
      <div class="composer-row">
        <select value={target} onChange={(event) => onTarget((event.target as HTMLSelectElement).value)} aria-label="Send to">
          {targets.map((name) => (
            <option key={name} value={name}>
              {name === 'queue' ? 'Queue (no chat)' : name}
            </option>
          ))}
        </select>
        <button type="button" class="button-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          class="button-ghost"
          disabled={empty || sending}
          title="Add to the batch and send later, together (⌘/Ctrl+Shift+Enter)"
          data-galley="add-to-batch"
          onClick={() => void submit(onBatch)}
        >
          Add to batch
        </button>
        <button type="submit" class="button-primary" disabled={empty || sending} title="Send (⌘/Ctrl+Enter)">
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
