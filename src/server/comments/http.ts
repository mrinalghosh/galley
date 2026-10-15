// Small JSON helpers for the comments routes.
import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

/**
 * Reads a JSON body of at most `limit` bytes. An empty body reads as undefined.
 * A non-empty body must be declared as JSON, which also keeps plain HTML forms out.
 */
export async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, `body is larger than ${limit} bytes`);

  const body = await collect(req, limit);
  if (body.length === 0) return undefined;

  const type = req.headers['content-type'] ?? '';
  if (!type.includes('application/json')) throw new HttpError(415, 'body must be application/json');
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'body is not valid JSON');
  }
}

// Keeps draining past the limit (discarding) so the 413 response still reaches
// the client instead of the socket being torn down mid-upload.
function collect(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => (size > limit ? reject(new HttpError(413, `body is larger than ${limit} bytes`)) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
