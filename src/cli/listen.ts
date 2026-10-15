// `galley listen --name <name>`: subscribes like a chat's Monitor does and
// prints each prompt to stdout, followed by a delimiter line.
import type { IncomingMessage } from 'node:http';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import { PREFIX, TOKEN_PARAM } from '../shared/constants.js';
import { findServer } from './server-client.js';

export const DELIMITER = '----- end of galley message -----';

export function listenUrl(port: number, name: string, token: string): string {
  const query = new URLSearchParams({ name, [TOKEN_PARAM]: token });
  return `ws://127.0.0.1:${port}${PREFIX}/listen?${query}`;
}

export async function listen(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { name: { type: 'string' }, cwd: { type: 'string', default: '.' } },
  });
  if (!values.name) throw new Error('usage: galley listen --name <name> [--cwd <project>]');
  const server = await findServer(values.cwd);
  const ws = new WebSocket(listenUrl(server.info.port, values.name, server.token));

  let stopping = false;
  process.once('SIGINT', () => {
    stopping = true;
    ws.close();
  });

  await new Promise<void>((resolve, reject) => {
    ws.on('unexpected-response', (_req, res) => {
      readBody(res).then((text) => reject(new Error(text || `server refused the listener (${res.statusCode})`)), reject);
    });
    ws.on('open', () => console.error(`galley: listening as "${values.name}" on port ${server.info.port}`));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      process.stdout.write(`${data.toString()}\n${DELIMITER}\n`);
    });
    ws.on('error', reject);
    ws.on('close', (code) => {
      if (!stopping) {
        console.error(`galley: listener closed (${code})`);
        process.exitCode = 1;
      }
      resolve();
    });
  });
}

function readBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => (text += chunk));
    res.on('end', () => resolve(text.replace(/^galley: /, '').trim()));
    res.on('error', reject);
  });
}
