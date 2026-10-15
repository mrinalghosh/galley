// Comments module: store, REST routes, WS events and the delivery registry.
import type { GalleyContext, GalleyModule } from '../types.js';
import { EventHub } from './events.js';
import { handleRoute } from './routes.js';
import { CommentService } from './service.js';
import { CommentStore } from './store.js';
import { type TargetRegistry, targets as defaultRegistry } from './targets.js';

export { listTargets, QUEUE_TARGET, registerTarget, unregisterTarget } from './targets.js';
export type { DeliveryTarget } from './targets.js';
export type { CommentService } from './service.js';

export interface CommentsModule extends GalleyModule {
  /** Available after init(). M3/M4 can use it to deliver or mark comments. */
  readonly service: CommentService | undefined;
}

export function createCommentsModule(registry: TargetRegistry = defaultRegistry): CommentsModule {
  let service: CommentService | undefined;
  const hub = new EventHub(() => [{ type: 'targets', targets: registry.list() }]);
  const cleanups: (() => void)[] = [];

  return {
    name: 'comments',
    get service() {
      return service;
    },

    init(ctx: GalleyContext) {
      const store = new CommentStore(ctx.dataDir);
      service = new CommentService(store, registry);
      cleanups.push(
        store.onEvent((event) => hub.broadcast(event)),
        registry.onChange((list) => hub.broadcast({ type: 'targets', targets: list })),
      );
    },

    http(req, res, path) {
      if (!service) return false;
      return handleRoute(service, req, res, path);
    },

    upgrade(req, socket, head, path) {
      if (path.split('?')[0] !== '/events') return false;
      hub.handleUpgrade(req, socket, head);
      return true;
    },

    async close() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      await hub.close();
    },
  };
}

export const commentsModule = createCommentsModule();
