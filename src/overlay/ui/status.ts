import type { CommentStatus } from '../../shared/protocol.js';

export const STATUSES: CommentStatus[] = ['queued', 'sent', 'done', 'failed'];

export const STATUS_LABEL: Record<CommentStatus, string> = {
  queued: 'Queued',
  sent: 'Sent',
  done: 'Done',
  failed: 'Failed',
};
