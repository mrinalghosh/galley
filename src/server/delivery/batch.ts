// Batched delivery. The seam's DeliveryTarget sends one comment at a time; a
// target that can also take several comments as ONE prompt adds sendBatch.
// Listeners implement it; the terminal (M4) can too.
import type { Comment } from '../../shared/protocol.js';
import type { DeliveryTarget } from '../comments/index.js';

export interface BatchDeliveryTarget extends DeliveryTarget {
  /** Deliver several comments as one prompt. Resolve once handed off. */
  sendBatch(comments: Comment[]): Promise<void>;
}

export function isBatchTarget(target: DeliveryTarget): target is BatchDeliveryTarget {
  return typeof (target as Partial<BatchDeliveryTarget>).sendBatch === 'function';
}
