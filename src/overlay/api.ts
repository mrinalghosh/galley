// Same-origin calls to the galley server. The session cookie is HttpOnly, so
// fetch must send credentials; the page never sees the token.
import { PREFIX } from '../shared/constants.js';
import type { Comment, NewComment, TargetInfo } from '../shared/protocol.js';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(PREFIX + path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data.error ?? `${method} ${path} failed (${res.status})`);
  return data;
}

export const api = {
  comments: () => request<{ comments: Comment[] }>('GET', '/comments').then((r) => r.comments),
  targets: () => request<{ targets: TargetInfo[] }>('GET', '/targets').then((r) => r.targets),
  create: (comment: NewComment) => request<{ comment: Comment }>('POST', '/comments', comment).then((r) => r.comment),
  send: (id: string, target?: string) =>
    request<{ comment: Comment }>('POST', `/comments/${encodeURIComponent(id)}/send`, target ? { target } : {}).then((r) => r.comment),
  remove: (id: string) => request<{ ok: true }>('DELETE', `/comments/${encodeURIComponent(id)}`),
  /** Sends every queued comment (or just `ids`) to `target` as one prompt (M3's queue module). */
  flush: (target: string, ids?: string[]) =>
    request<{ comments: Comment[] }>('POST', '/queue/flush', ids ? { target, ids } : { target }).then((r) => r.comments),
};
