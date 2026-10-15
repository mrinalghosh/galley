// Small shell helpers: page config, remembered UI state, the framed path.
import { useState } from 'preact/hooks';
import { PREFIX } from '../shared/constants.js';

export interface ShellConfig {
  target: string;
  port: number;
  cwd: string;
}

export function readConfig(): ShellConfig {
  const fallback: ShellConfig = { target: '', port: Number(location.port), cwd: '' };
  try {
    const text = document.getElementById('galley-config')?.textContent;
    return text ? { ...fallback, ...(JSON.parse(text) as Partial<ShellConfig>) } : fallback;
  } catch {
    return fallback;
  }
}

/** useState that survives reloads via localStorage, per viewer. Storage failures are ignored. */
export function useStoredState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : (JSON.parse(stored) as T);
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Private mode or blocked storage: keep the in-memory value.
    }
  };
  return [value, set];
}

/**
 * The site path kept in the shell's hash (#/pricing?x=1), so reloading the
 * shell reopens the same page. Only same-origin paths outside PREFIX qualify.
 */
export function sitePathFromHash(hash: string): string {
  try {
    return safeSitePath(decodeURI(hash.replace(/^#/, ''))) ?? '/';
  } catch {
    return '/';
  }
}

export function safeSitePath(path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  try {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin || url.pathname.startsWith(PREFIX)) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

export function rememberSitePath(path: string): void {
  if (safeSitePath(path) === null) return;
  history.replaceState(null, '', `#${encodeURI(path)}`);
}
