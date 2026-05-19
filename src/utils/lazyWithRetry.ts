import { lazy, type ComponentType } from 'react';

// See specs/chunk-load-recovery.md
const RELOAD_KEY = 'chunkLoadReloaded';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    try {
      const mod = await importFn();
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(RELOAD_KEY);
      }
      return mod;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const mod = await importFn();
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem(RELOAD_KEY);
        }
        return mod;
      } catch (err) {
        if (typeof window !== 'undefined' && !sessionStorage.getItem(RELOAD_KEY)) {
          sessionStorage.setItem(RELOAD_KEY, '1');
          window.location.reload();
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      }
    }
  });
}
