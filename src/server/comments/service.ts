// Comment lifecycle: create, deliver to a registered target, mark done/failed.
import type { Comment, NewComment } from '../../shared/protocol.js';
import type { CommentStore } from './store.js';
import { QUEUE_TARGET, type TargetRegistry } from './targets.js';

export const DELIVERY_TIMEOUT_MS = 10_000;

export class CommentService {
  constructor(
    readonly store: CommentStore,
    readonly registry: TargetRegistry,
    private timeoutMs = DELIVERY_TIMEOUT_MS,
  ) {}

  async create(input: NewComment): Promise<Comment> {
    const comment = this.store.create(input);
    return this.deliver(comment.id, comment.target);
  }

  /**
   * Sends a comment to `targetName` (default: its stored target). When that
   * target isn't registered, the comment stays queued under that name.
   */
  async deliver(id: string, targetName?: string): Promise<Comment> {
    const comment = this.store.get(id);
    if (!comment) throw new Error(`no comment ${id}`);
    const name = targetName ?? comment.target;
    const target = name === QUEUE_TARGET ? undefined : this.registry.get(name);
    if (!target) return this.store.setStatus(id, { status: 'queued', target: name }) ?? comment;

    const before = name === comment.target ? comment : this.store.setStatus(id, { status: comment.status, note: comment.note, target: name })!;
    try {
      await withTimeout(target.send(before), this.timeoutMs);
    } catch (error) {
      return this.settle(before, { status: 'failed', note: `delivery to ${name} failed: ${errorMessage(error)}` });
    }
    return this.settle(before, { status: 'sent' });
  }

  markDone(id: string, note?: string): Comment | undefined {
    return this.store.setStatus(id, { status: 'done', note });
  }

  markFailed(id: string, reason?: string): Comment | undefined {
    return this.store.setStatus(id, { status: 'failed', note: reason });
  }

  // If the chat marked it done (or anything else changed it) while send() was
  // pending, keep that newer state instead of overwriting it with "sent".
  private settle(before: Comment, change: { status: 'sent' | 'failed'; note?: string }): Comment {
    const current = this.store.get(before.id);
    if (!current) return before;
    if (current !== before) return current;
    return this.store.setStatus(before.id, change) ?? current;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
