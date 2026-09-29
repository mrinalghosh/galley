// Append-only comment log. Each line of comments.jsonl is one record: a new
// comment, a status change or a delete. Loading folds them into current state.
import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Comment, CommentStatus, NewComment, ServerEvent } from '../../shared/protocol.js';
import { newCommentId } from './ids.js';

export type LogRecord =
  | { type: 'comment'; comment: Comment }
  | { type: 'status'; id: string; status: CommentStatus; note?: string; target?: string; at: string }
  | { type: 'delete'; id: string; at: string };

export interface StatusChange {
  status: CommentStatus;
  note?: string;
  target?: string;
}

type Listener = (event: ServerEvent) => void;

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/;

/** Folds log records into comments keyed by id, in creation order. Pure. */
export function foldRecords(records: Iterable<LogRecord>): Map<string, Comment> {
  const comments = new Map<string, Comment>();
  for (const record of records) {
    if (record.type === 'comment') {
      comments.set(record.comment.id, record.comment);
      continue;
    }
    const current = comments.get(record.id);
    if (!current) continue;
    if (record.type === 'delete') {
      comments.delete(record.id);
      continue;
    }
    comments.set(record.id, applyStatus(current, record));
  }
  return comments;
}

function applyStatus(comment: Comment, change: StatusChange): Comment {
  const next: Comment = { ...comment, status: change.status };
  if (change.target !== undefined) next.target = change.target;
  // A note belongs to the state that produced it (done note, failure reason).
  if (change.note !== undefined) next.note = change.note;
  else delete next.note;
  return next;
}

/** Parses the log, skipping blank or corrupt lines (e.g. a torn final write). */
export function parseLog(text: string): LogRecord[] {
  const records: LogRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as LogRecord;
      if (record && typeof record === 'object' && typeof record.type === 'string') records.push(record);
    } catch {
      // Ignore: one bad line must not lose the rest of the history.
    }
  }
  return records;
}

export class CommentStore {
  readonly file: string;
  readonly shotsDir: string;
  private comments = new Map<string, Comment>();
  private listeners = new Set<Listener>();

  constructor(readonly dataDir: string) {
    this.file = join(dataDir, 'comments.jsonl');
    this.shotsDir = join(dataDir, 'shots');
    mkdirSync(dataDir, { recursive: true });
    this.load();
  }

  load(): void {
    let text = '';
    try {
      text = readFileSync(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.comments = foldRecords(parseLog(text));
  }

  list(): Comment[] {
    return [...this.comments.values()];
  }

  get(id: string): Comment | undefined {
    return this.comments.get(id);
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stores a new comment as queued. Delivery is the caller's job. */
  create(input: NewComment, now: Date = new Date()): Comment {
    const { screenshotDataUrl, ...rest } = input;
    const comment: Comment = { ...rest, id: newCommentId(now.getTime()), createdAt: now.toISOString(), status: 'queued' };
    if (screenshotDataUrl) comment.screenshot = this.writeShot(comment.id, screenshotDataUrl);
    this.append({ type: 'comment', comment });
    this.comments.set(comment.id, comment);
    this.emit({ type: 'comment', comment });
    return comment;
  }

  setStatus(id: string, change: StatusChange): Comment | undefined {
    const current = this.comments.get(id);
    if (!current) return undefined;
    const record: LogRecord = { type: 'status', id, ...change, at: new Date().toISOString() };
    this.append(record);
    const next = applyStatus(current, change);
    this.comments.set(id, next);
    this.emit({ type: 'comment', comment: next });
    return next;
  }

  delete(id: string): boolean {
    const current = this.comments.get(id);
    if (!current) return false;
    this.append({ type: 'delete', id, at: new Date().toISOString() });
    this.comments.delete(id);
    if (current.screenshot) {
      try {
        unlinkSync(current.screenshot);
      } catch {
        // Already gone; nothing to clean up.
      }
    }
    this.emit({ type: 'comment-deleted', id });
    return true;
  }

  private writeShot(id: string, dataUrl: string): string {
    const match = PNG_DATA_URL.exec(dataUrl);
    if (!match?.[1]) throw new Error('screenshotDataUrl must be a base64 PNG data URL');
    mkdirSync(this.shotsDir, { recursive: true });
    const path = join(this.shotsDir, `${id}.png`);
    writeFileSync(path, Buffer.from(match[1], 'base64'));
    return path;
  }

  private append(record: LogRecord): void {
    appendFileSync(this.file, JSON.stringify(record) + '\n');
  }

  private emit(event: ServerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
