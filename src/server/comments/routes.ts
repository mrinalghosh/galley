// HTTP routes under PREFIX. `path` arrives with PREFIX already removed.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson } from './http.js';
import type { CommentService } from './service.js';
import { validateNewComment, validateNote, validateSend } from './validate.js';

/** New comments may carry a screenshot as a data URL. */
export const MAX_COMMENT_BODY = 16 * 1024 * 1024;
export const MAX_SMALL_BODY = 64 * 1024;

const COMMENT_ACTION = /^\/comments\/([A-Za-z0-9_-]{1,64})(?:\/(send|done|fail))?\/?$/;

export async function handleRoute(service: CommentService, req: IncomingMessage, res: ServerResponse, rawPath: string): Promise<boolean> {
  const path = rawPath.split('?')[0] ?? '';
  const method = req.method ?? 'GET';
  try {
    if (path === '/targets') {
      if (method !== 'GET') throw methodNotAllowed(res, 'GET');
      sendJson(res, 200, { targets: service.registry.list() });
      return true;
    }
    if (path === '/comments' || path === '/comments/') {
      await commentsCollection(service, req, res, method);
      return true;
    }
    const match = COMMENT_ACTION.exec(path);
    if (match) {
      await commentItem(service, req, res, method, match[1]!, match[2]);
      return true;
    }
    if (path.startsWith('/comments/')) throw new HttpError(404, 'not found');
    return false;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    if (error.status === 413) res.setHeader('connection', 'close');
    if (!res.headersSent) sendJson(res, error.status, { error: error.message });
    return true;
  }
}

async function commentsCollection(service: CommentService, req: IncomingMessage, res: ServerResponse, method: string): Promise<void> {
  if (method === 'GET') {
    sendJson(res, 200, { comments: service.store.list() });
    return;
  }
  if (method !== 'POST') throw methodNotAllowed(res, 'GET, POST');
  const parsed = validateNewComment(await readJson(req, MAX_COMMENT_BODY));
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  sendJson(res, 201, { comment: await service.create(parsed.value) });
}

async function commentItem(
  service: CommentService,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  id: string,
  action: string | undefined,
): Promise<void> {
  if (!action) {
    if (method !== 'DELETE') throw methodNotAllowed(res, 'DELETE');
    if (!service.store.delete(id)) throw new HttpError(404, `no comment ${id}`);
    sendJson(res, 200, { ok: true, id });
    return;
  }
  if (method !== 'POST') throw methodNotAllowed(res, 'POST');
  const body = await readJson(req, MAX_SMALL_BODY);
  if (!service.store.get(id)) throw new HttpError(404, `no comment ${id}`);

  if (action === 'send') {
    const parsed = validateSend(body);
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    sendJson(res, 200, { comment: await service.deliver(id, parsed.value.target) });
    return;
  }
  const key = action === 'done' ? 'note' : 'reason';
  const parsed = validateNote(body, key);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  const comment = action === 'done' ? service.markDone(id, parsed.value) : service.markFailed(id, parsed.value);
  sendJson(res, 200, { comment });
}

function methodNotAllowed(res: ServerResponse, allow: string): HttpError {
  res.setHeader('allow', allow);
  return new HttpError(405, 'method not allowed');
}
