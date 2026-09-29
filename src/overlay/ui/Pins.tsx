import type { Comment } from '../../shared/protocol.js';
import { anchorFor, clamp } from '../geometry.js';
import { Highlight } from './Highlight.js';
import { STATUS_LABEL } from './status.js';

const PIN = 22;

interface Props {
  comments: Comment[];
  numbers: Map<string, number>;
  openId: string | undefined;
  hoverId: string | undefined;
  onOpen(id: string | undefined): void;
  onHover(id: string | undefined): void;
}

/** One numbered pin per comment on this page, re-anchored on every render. */
export function Pins({ comments, numbers, openId, hoverId, onOpen, onHover }: Props) {
  const vw = window.innerWidth;
  const taken: { x: number; y: number }[] = [];
  return (
    <>
      {comments.map((comment) => {
        const anchor = anchorFor(comment);
        const { rect } = anchor;
        // Sit on the element's top-left corner, nudged inward at the viewport edge.
        let x = clamp(rect.x - PIN / 2, 2, vw - PIN - 2);
        const onScreen = rect.y + rect.h > 0;
        const y = onScreen ? Math.max(2, rect.y - PIN / 2) : rect.y - PIN / 2;
        // Several comments on one element: fan the pins out to the right.
        while (taken.some((p) => Math.abs(p.x - x) < PIN - 4 && Math.abs(p.y - y) < PIN - 4)) x += PIN - 2;
        taken.push({ x, y });
        const active = comment.id === openId || comment.id === hoverId;
        return (
          <div key={comment.id}>
            {active && <Highlight rect={rect} kind="hover" />}
            <button
              type="button"
              class={`pin pin-${comment.status} ${anchor.source === 'stored' ? 'pin-detached' : ''} ${active ? 'pin-active' : ''}`}
              style={{ transform: `translate(${x}px, ${y}px)` }}
              data-comment-id={comment.id}
              data-anchor={anchor.source}
              aria-label={`Comment ${numbers.get(comment.id)}: ${STATUS_LABEL[comment.status]}`}
              onMouseEnter={() => onHover(comment.id)}
              onMouseLeave={() => onHover(undefined)}
              onClick={() => onOpen(openId === comment.id ? undefined : comment.id)}
            >
              {numbers.get(comment.id)}
            </button>
            {active && <PinCard comment={comment} number={numbers.get(comment.id) ?? 0} x={x} y={y} />}
          </div>
        );
      })}
    </>
  );
}

function PinCard({ comment, number, x, y }: { comment: Comment; number: number; x: number; y: number }) {
  const width = 260;
  const left = clamp(x + PIN + 6, 8, window.innerWidth - width - 8);
  return (
    <div class="pin-card" style={{ transform: `translate(${left}px, ${Math.max(8, y)}px)`, width: `${width}px` }}>
      <div class="pin-card-head">
        <span class={`dot dot-${comment.status}`} />#{number} · {STATUS_LABEL[comment.status]}
        {comment.target !== 'queue' && <span class="muted"> → {comment.target}</span>}
      </div>
      <div class="pin-card-text">{comment.text}</div>
      {comment.note && <div class={`pin-card-note note-${comment.status}`}>{comment.note}</div>}
    </div>
  );
}
