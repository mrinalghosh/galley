// Shown when a destination is picked while comments are still queued.
import { useState } from 'preact/hooks';

interface Props {
  target: string;
  count: number;
  onSend(): Promise<void>;
  onDismiss(): void;
}

export function FlushOffer({ target, count, onSend, onDismiss }: Props) {
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
  const label = target === 'terminal' ? 'the terminal' : target;
  return (
    <div class="g-banner" role="status" data-galley="flush-offer">
      <span>
        {count} queued comment{count === 1 ? '' : 's'}. Send {count === 1 ? 'it' : 'them'} to {label}
        {count === 1 ? '' : ' as one prompt'}?{error && ` (${error})`}
      </span>
      <button class="g-btn" disabled={sending} onClick={send}>
        {sending ? 'Sending…' : 'Send'}
      </button>
      <button class="g-btn" onClick={onDismiss}>
        Not now
      </button>
    </div>
  );
}
