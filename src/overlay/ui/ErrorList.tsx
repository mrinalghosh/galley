import { useState } from 'preact/hooks';
import type { CapturedError } from '../../shared/protocol.js';

interface Props {
  /** Oldest first, as the ring keeps them; shown newest first. */
  errors: CapturedError[];
  /** Where a fix request goes, for the button's tooltip. */
  target: string;
  onSendFix(error: CapturedError): Promise<void>;
  onEdit(error: CapturedError): void;
  onClear(): void;
  onClose(): void;
}

type SendState = 'sending' | 'sent' | { error: string };

/** Recent uncaught errors on this page, each one click away from a fix request. */
export function ErrorList({ errors, target, onSendFix, onEdit, onClear, onClose }: Props) {
  // Keyed by the error object: the ring keeps the same objects until cleared.
  const [states, setStates] = useState(() => new Map<CapturedError, SendState>());
  const setState = (error: CapturedError, state: SendState) => setStates((prev) => new Map(prev).set(error, state));

  const send = async (error: CapturedError) => {
    setState(error, 'sending');
    try {
      await onSendFix(error);
      setState(error, 'sent');
    } catch (err) {
      setState(error, { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const destination = target === 'queue' ? 'the queue' : target;
  return (
    <aside class="panel errors-panel" data-galley="errors" onKeyDown={(event) => event.stopPropagation()}>
      <header class="panel-head">
        <strong>Recent errors</strong>
        {errors.length > 0 && (
          <button type="button" class="button-ghost button-small" onClick={onClear}>
            Clear
          </button>
        )}
        <button type="button" class="icon-button" aria-label="Close errors" onClick={onClose}>
          ×
        </button>
      </header>
      <ol class="panel-list">
        {errors.length === 0 && <li class="empty">No uncaught errors on this page.</li>}
        {errors
          .slice()
          .reverse()
          .map((error) => {
            const state = states.get(error);
            return (
              <li key={`${error.at}:${error.message}`} class="item error-item" data-galley="error-item">
                <div class="error-message">{error.message}</div>
                {error.stack && <div class="error-stack">{firstFrame(error)}</div>}
                <div class="item-meta">{new Date(error.at).toLocaleTimeString()}</div>
                {typeof state === 'object' && <div class="panel-error">{state.error}</div>}
                <span class="item-actions">
                  <button type="button" class="button-ghost" onClick={() => onEdit(error)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    class="button-primary"
                    disabled={state === 'sending'}
                    title={`Send "Fix this error" with its stack to ${destination}`}
                    data-galley="send-fix"
                    onClick={() => void send(error)}
                  >
                    {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent ✓' : 'Send fix request'}
                  </button>
                </span>
              </li>
            );
          })}
      </ol>
    </aside>
  );
}

/** The first stack line that isn't the message itself: where it was thrown. */
function firstFrame(error: CapturedError): string {
  const lines = (error.stack ?? '').split('\n').map((line) => line.trim());
  return lines.find((line) => line && !error.message.endsWith(line) && line !== error.message) ?? '';
}
