import { commentsModule } from './comments/index.js';
import { queueModule } from './delivery/index.js';
import { listenModule } from './listen/index.js';
import { ptyModule } from './pty/index.js';
import type { GalleyModule } from './types.js';

// Every feature under PREFIX registers here. One line per module; the server
// tries them in order. Add your module's import and entry; don't reorder others.
export const modules: GalleyModule[] = [
  commentsModule,
  listenModule,
  queueModule,
  ptyModule,
];
