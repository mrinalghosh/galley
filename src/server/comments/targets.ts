// Delivery seam. Destinations (the browser terminal, listening chats) register
// here; the comments module looks them up by name when a comment is sent.
import type { Comment, TargetInfo } from '../../shared/protocol.js';

export interface DeliveryTarget extends TargetInfo {
  /** Deliver one comment. Resolve once handed off; reject to mark it failed. */
  send(comment: Comment): Promise<void>;
}

/** The pseudo-target that holds comments until a real one is chosen. */
export const QUEUE_TARGET = 'queue';

type Listener = (targets: TargetInfo[]) => void;

export class TargetRegistry {
  private targets = new Map<string, DeliveryTarget>();
  private listeners = new Set<Listener>();

  /**
   * Adds a target, replacing any with the same name. Returns an unregister
   * function that only removes this exact target, so a stale connection can't
   * remove its replacement.
   */
  register(target: DeliveryTarget): () => void {
    if (!target.name || target.name === QUEUE_TARGET) throw new Error(`invalid target name: ${target.name}`);
    this.targets.set(target.name, target);
    this.changed();
    return () => {
      if (this.targets.get(target.name) === target) this.unregister(target.name);
    };
  }

  unregister(name: string): boolean {
    const removed = this.targets.delete(name);
    if (removed) this.changed();
    return removed;
  }

  get(name: string): DeliveryTarget | undefined {
    return this.targets.get(name);
  }

  /** Terminal first, then listeners by name. */
  list(): TargetInfo[] {
    return [...this.targets.values()]
      .map(({ name, kind }) => ({ name, kind }))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'terminal' ? -1 : 1));
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    const list = this.list();
    for (const listener of this.listeners) listener(list);
  }
}

/** One registry per galley process. M3 (listeners) and M4 (terminal) use these. */
export const targets = new TargetRegistry();
export const registerTarget = (target: DeliveryTarget): (() => void) => targets.register(target);
export const unregisterTarget = (name: string): boolean => targets.unregister(name);
export const listTargets = (): TargetInfo[] => targets.list();
