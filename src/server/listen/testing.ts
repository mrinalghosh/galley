// Test harness: a real galley server (comments + listen + queue modules) on a
// fixed port, with a fresh target registry and a temp project folder that
// looks like a running `galley` (server.json with this pid, token file).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDataDir, writeServerInfo, writeToken } from '../../cli/project.js';
import { PREFIX } from '../../shared/constants.js';
import { createCommentsModule, type CommentsModule } from '../comments/index.js';
import { TargetRegistry } from '../comments/targets.js';
import { createQueueModule } from '../delivery/index.js';
import { createGalleyServer } from '../index.js';
import type { GalleyContext } from '../types.js';
import { createListenModule, type ListenModule } from './index.js';

export interface TestServer {
  cwd: string;
  ctx: GalleyContext;
  base: string;
  comments: CommentsModule;
  listen: ListenModule;
  close(): Promise<void>;
}

export async function startTestServer(port: number, pingIntervalMs = 30_000): Promise<TestServer> {
  const cwd = mkdtempSync(join(tmpdir(), 'galley-listen-'));
  const dataDir = await ensureDataDir(cwd);
  const ctx: GalleyContext = { cwd, dataDir, port, target: new URL('http://127.0.0.1:1'), token: 'test-token', agent: 'claude' };
  const registry = new TargetRegistry();
  const comments = createCommentsModule(registry);
  const listen = createListenModule({ registry, cli: 'galley', pingIntervalMs, getService: () => comments.service });
  const galley = createGalleyServer({ ctx, modules: [comments, listen, createQueueModule(() => comments.service)], clientDir: cwd });
  await galley.listen();
  await writeToken(dataDir, ctx.token);
  await writeServerInfo(dataDir, { port, target: ctx.target.href, pid: process.pid, startedAt: new Date().toISOString() });
  return {
    cwd,
    ctx,
    base: `http://localhost:${port}${PREFIX}`,
    comments,
    listen,
    async close() {
      await galley.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}
