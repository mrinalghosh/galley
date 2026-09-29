// Queue flush: comments written while nothing was connected are held as
// 'queued' and go to the first destination picked later, as ONE prompt.
import type { Comment } from '../../shared/protocol.js';
import { type CommentService, QUEUE_TARGET } from '../comments/index.js';
import { DELIVERY_TIMEOUT_MS } from '../comments/service.js';
import { isBatchTarget } from './batch.js';

export class FlushError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Delivers every queued comment (or just `ids`, when given) to `targetName`.
 * Batch-capable targets get one prompt; others get one send per comment.
 * Returns the comments with their new status, in creation order.
 */
export async function flushQueue(
  service: CommentService,
  targetName: string,
  ids?: string[],
  timeoutMs = DELIVERY_TIMEOUT_MS,
): Promise<Comment[]> {
  if (targetName === QUEUE_TARGET) throw new FlushError(400, 'pick a connected target, not "queue"');
  const target = service.registry.get(targetName);
  if (!target) throw new FlushError(409, `target "${targetName}" is not connected`);

  const wanted = ids ? new Set(ids) : undefined;
  const queued = service.store.list().filter((c) => c.status === 'queued' && (!wanted || wanted.has(c.id)));
  if (queued.length === 0) return [];

  if (!isBatchTarget(target)) {
    const results: Comment[] = [];
    for (const comment of queued) results.push(await service.deliver(comment.id, targetName));
    return results;
  }

  // Point each comment at its destination first, so the pins and the prompt agree.
  const before = queued.map((c) => service.store.setStatus(c.id, { status: 'queued', note: c.note, target: targetName }) ?? c);
  let failure: string | undefined;
  try {
    await withTimeout(target.sendBatch(before), timeoutMs);
  } catch (error) {
    failure = `delivery to ${targetName} failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  return before.map((comment) => settle(service, comment, failure));
}

// A done/fail that arrived while the send was pending wins over "sent".
function settle(service: CommentService, before: Comment, failure: string | undefined): Comment {
  const current = service.store.get(before.id);
  if (!current) return before;
  if (current !== before) return current;
  const change = failure ? { status: 'failed' as const, note: failure } : { status: 'sent' as const };
  return service.store.setStatus(before.id, change) ?? current;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
