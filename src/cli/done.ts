// `galley done <id> "<note>"` and `galley fail <id> "<reason>"`: what a chat
// runs after handling a comment. Works from any directory with --cwd.
import { parseArgs } from 'node:util';
import type { Comment } from '../shared/protocol.js';
import { callServer, errorText, findServer } from './server-client.js';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface MarkArgs {
  id: string;
  text: string | undefined;
  cwd: string;
}

export function parseMarkArgs(action: 'done' | 'fail', args: string[]): MarkArgs {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { cwd: { type: 'string', default: '.' } },
  });
  const [id, ...words] = positionals;
  const placeholder = action === 'done' ? 'note' : 'reason';
  if (!id) throw new Error(`usage: galley ${action} <comment-id> "<${placeholder}>" [--cwd <project>]`);
  if (!ID.test(id)) throw new Error(`invalid comment id "${id}"`);
  // An unquoted note arrives as several words; keep it as one line.
  const text = words.join(' ').trim() || undefined;
  return { id, text, cwd: values.cwd };
}

async function mark(action: 'done' | 'fail', args: string[]): Promise<void> {
  const { id, text, cwd } = parseMarkArgs(action, args);
  const server = await findServer(cwd);
  const body = text === undefined ? {} : action === 'done' ? { note: text } : { reason: text };
  const res = await callServer(server, 'POST', `/comments/${encodeURIComponent(id)}/${action}`, body);
  if (res.status !== 200) throw new Error(`${action} ${id} failed (${res.status}): ${errorText(res.body)}`);

  const comment = (res.body as { comment: Comment }).comment;
  const suffix = comment.note ? `: ${comment.note}` : '';
  console.log(`galley: ${comment.id} marked ${comment.status}${suffix}`);
}

export const done = (args: string[]) => mark('done', args);
export const fail = (args: string[]) => mark('fail', args);
