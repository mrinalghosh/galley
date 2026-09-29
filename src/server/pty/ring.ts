// Scrollback for the browser terminal: the most recent output, capped by size,
// replayed to a viewer when it (re)connects.

export const SCROLLBACK_BYTES = 256 * 1024;

export class RingBuffer {
  private chunks: string[] = [];
  private bytes = 0;

  constructor(private readonly maxBytes = SCROLLBACK_BYTES) {}

  push(data: string): void {
    if (!data) return;
    this.chunks.push(data);
    this.bytes += Buffer.byteLength(data);
    this.trim();
  }

  /** Everything kept, oldest first, as one string. */
  contents(): string {
    return this.chunks.join('');
  }

  get size(): number {
    return this.bytes;
  }

  clear(): void {
    this.chunks = [];
    this.bytes = 0;
  }

  // Drops whole chunks from the front; only the last surviving chunk is cut,
  // so at most one escape sequence at the very start of the replay is split.
  private trim(): void {
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      this.bytes -= Buffer.byteLength(this.chunks.shift()!);
    }
    if (this.bytes <= this.maxBytes) return;
    const only = this.chunks[0]!;
    const kept = tailBytes(only, this.maxBytes);
    this.chunks = [kept];
    this.bytes = Buffer.byteLength(kept);
  }
}

/** The longest suffix of `text` that fits in `max` UTF-8 bytes, never splitting a character. */
function tailBytes(text: string, max: number): string {
  const buf = Buffer.from(text);
  let start = buf.length - max;
  // Skip UTF-8 continuation bytes (10xxxxxx) so we start on a character boundary.
  while (start < buf.length && (buf[start]! & 0xc0) === 0x80) start++;
  return buf.subarray(start).toString();
}
