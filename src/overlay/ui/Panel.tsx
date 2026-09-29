import { useState } from 'preact/hooks';
import type { Comment, CommentStatus } from '../../shared/protocol.js';
import { STATUS_LABEL, STATUSES } from './status.js';

interface Props {
  comments: Comment[];
  numbers: Map<string, number>;
  currentUrl: string;
  connected: boolean;
  onClose(): void;
  onReveal(comment: Comment): void;
  onSend(comment: Comment): Promise<void>;
  onDelete(comment: Comment): Promise<void>;
}

type Filter = CommentStatus | 'all';

/** Every comment in the project, filterable by status, with send and delete. */
export function Panel({ comments, numbers, currentUrl, connected, onClose, onReveal, onSend, onDelete }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string>();
  const shown = filter === 'all' ? comments : comments.filter((c) => c.status === filter);
  const count = (status: CommentStatus) => comments.filter((c) => c.status === status).length;

  const run = (action: Promise<void>) =>
    action.then(
      () => setError(undefined),
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );

  return (
    <aside class="panel" data-galley="panel" onKeyDown={(event) => event.stopPropagation()}>
      <header class="panel-head">
        <strong>Comments</strong>
        {!connected && <span class="muted" title="Reconnecting to galley">offline</span>}
        <button type="button" class="icon-button" aria-label="Close comments" onClick={onClose}>
          ×
        </button>
      </header>
      <div class="filters" role="tablist">
        <FilterChip label="All" count={comments.length} active={filter === 'all'} onClick={() => setFilter('all')} />
        {STATUSES.map((status) => (
          <FilterChip
            key={status}
            label={STATUS_LABEL[status]}
            count={count(status)}
            status={status}
            active={filter === status}
            onClick={() => setFilter(status)}
          />
        ))}
      </div>
      {error && <div class="panel-error">{error}</div>}
      <ol class="panel-list">
        {shown.length === 0 && <li class="empty">{comments.length ? 'Nothing with this status.' : 'No comments yet. Press C to pick an element.'}</li>}
        {shown.map((comment) => (
          <li key={comment.id} class="item" data-comment-id={comment.id}>
            <button type="button" class="item-main" onClick={() => onReveal(comment)} title="Show on page">
              <span class={`badge badge-${comment.status}`}>{numbers.get(comment.id)}</span>
              <span class="item-body">
                <span class="item-text">{comment.text}</span>
                {comment.note && <span class={`item-note note-${comment.status}`}>{comment.note}</span>}
                <span class="item-meta">
                  {STATUS_LABEL[comment.status]} · {comment.target === 'queue' ? 'queue' : `→ ${comment.target}`}
                  {comment.url !== currentUrl && ` · ${comment.url}`}
                  {comment.batch && ' · batch'}
                  {comment.errors?.length ? ` · ${comment.errors.length} error${comment.errors.length === 1 ? '' : 's'}` : ''}
                </span>
              </span>
            </button>
            <span class="item-actions">
              <button type="button" class="button-ghost" onClick={() => run(onSend(comment))}>
                {comment.status === 'queued' ? 'Send' : 'Resend'}
              </button>
              <button type="button" class="button-ghost danger" onClick={() => run(onDelete(comment))}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function FilterChip(props: { label: string; count: number; active: boolean; status?: CommentStatus; onClick(): void }) {
  return (
    <button type="button" role="tab" aria-selected={props.active} class={`chip ${props.active ? 'chip-active' : ''}`} onClick={props.onClick}>
      {props.status && <span class={`dot dot-${props.status}`} />}
      {props.label} <span class="muted">{props.count}</span>
    </button>
  );
}
