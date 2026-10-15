// Delivery helpers shared by listeners (M3) and the terminal (M4), plus the
// queue module: POST PREFIX/queue/flush {target, ids?} sends queued comments
// to a connected target as one prompt.
import type { CommentService } from '../comments/index.js';
import { commentsModule } from '../comments/index.js';
import { HttpError, readJson, sendJson } from '../comments/http.js';
import type { GalleyModule } from '../types.js';
import { FlushError, flushQueue } from './flush.js';

export { type BatchDeliveryTarget, isBatchTarget } from './batch.js';
export { resolveCliCommand } from './cli.js';
export { flushQueue, FlushError } from './flush.js';
export { formatPrompt, type PromptContext } from './prompt.js';

const MAX_BODY = 64 * 1024;

export function createQueueModule(getService: () => CommentService | undefined = () => commentsModule.service): GalleyModule {
  return {
    name: 'queue',
    async http(req, res, path) {
      if (path !== '/queue/flush') return false;
      const service = getService();
      if (!service) return false;
      try {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST');
          throw new HttpError(405, 'method not allowed');
        }
        const { target, ids } = parseFlushBody(await readJson(req, MAX_BODY));
        sendJson(res, 200, { target, comments: await flushQueue(service, target, ids) });
      } catch (error) {
        if (error instanceof HttpError || error instanceof FlushError) sendJson(res, error.status, { error: error.message });
        else throw error;
      }
      return true;
    },
  };
}

function parseFlushBody(body: unknown): { target: string; ids?: string[] } {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'body must be {"target": "<name>"}');
  const { target, ids } = body as { target?: unknown; ids?: unknown };
  if (typeof target !== 'string' || !target) throw new HttpError(400, 'target must be a non-empty string');
  if (ids === undefined) return { target };
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new HttpError(400, 'ids must be an array of strings');
  return { target, ids };
}

export const queueModule = createQueueModule();
