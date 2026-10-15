// Terminal queries: sequences a program writes to ask the terminal something
// (cursor position, device attributes, colours). The attached xterm answers
// them live. They are not output: an idle Claude Code keeps polling the cursor
// position (CSI ? 6 n) several times a second, which must neither count as
// activity nor be replayed from scrollback, where every stale query would get
// a stale answer typed back into the agent.

const QUERIES = new RegExp(
  [
    '\\x1b\\[[?]?\\d*n', // DSR: status, cursor position (CSI 5n, CSI 6n, CSI ?6n)
    '\\x1b\\[[>=]?\\d*c', // DA1 / DA2 / DA3: device attributes
    '\\x1b\\[>\\d*q', // XTVERSION
    '\\x1b\\[\\??\\d+\\$p', // DECRQM: request mode
    '\\x1b\\[\\?u', // kitty keyboard flags
    '\\x1b\\](?:4;\\d+|1[0-2]);\\?(?:\\x07|\\x1b\\\\)', // OSC colour queries
  ].join('|'),
  'g',
);

export function stripTerminalQueries(data: string): string {
  return data.includes('\x1b') ? data.replace(QUERIES, '') : data;
}
