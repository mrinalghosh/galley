// Send targets for the shell: the connected destinations (from GET /targets and
// `targets` events on WS /events), the queued comments that could be flushed to
// one, and the remembered choice per target site.
import { useEffect, useState } from 'preact/hooks';
import { api } from '../overlay/api.js';
import { connectEvents } from '../overlay/events.js';
import { PREFIX } from '../shared/constants.js';
import type { Comment, TargetInfo } from '../shared/protocol.js';
import { useStoredState } from './state.js';
import type { TargetOption } from './Toolbar.js';

export const QUEUE = 'queue';

export interface Destinations {
  targets: TargetInfo[];
  queued: Comment[];
}

export function useDestinations(): Destinations {
  const [targets, setTargets] = useState<TargetInfo[]>([]);
  const [comments, setComments] = useState<Map<string, Comment>>(() => new Map());

  useEffect(() => {
    const update = (fn: (next: Map<string, Comment>) => void) =>
      setComments((prev) => {
        const next = new Map(prev);
        fn(next);
        return next;
      });
    const stream = connectEvents({
      onOpen: () => {
        api.targets().then(setTargets, () => {});
        api.comments().then((list) => setComments(new Map(list.map((c) => [c.id, c]))), () => {});
      },
      // While disconnected nothing is known to be listening.
      onClose: () => setTargets([]),
      onEvent: (event) => {
        if (event.type === 'targets') setTargets(event.targets);
        else if (event.type === 'comment') update((next) => next.set(event.comment.id, event.comment));
        else if (event.type === 'comment-deleted') update((next) => next.delete(event.id));
      },
    });
    return () => stream.close();
  }, []);

  return { targets, queued: [...comments.values()].filter((c) => c.status === 'queued') };
}

/** The last target picked for this site, kept per viewer across reloads. */
export function useRememberedTarget(site: string): [string, (name: string) => void] {
  return useStoredState(`galley.target:${site}`, QUEUE);
}

/** The remembered target while it is connected; the queue otherwise. */
export function effectiveTarget(remembered: string, targets: TargetInfo[]): string {
  return targets.some((t) => t.name === remembered) ? remembered : QUEUE;
}

export function targetOptions(targets: TargetInfo[]): TargetOption[] {
  return [
    ...targets.map((t) => ({ value: t.name, label: t.kind === 'terminal' ? 'Terminal' : t.name })),
    { value: QUEUE, label: 'Queue (no chat)' },
  ];
}

/** Sends every queued comment to `target` as one prompt. */
export async function flushQueued(target: string): Promise<void> {
  const res = await fetch(`${PREFIX}/queue/flush`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `flush failed (${res.status})`);
  }
}
