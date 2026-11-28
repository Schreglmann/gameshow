import { lazy, type ComponentType } from 'react';
import { waitForServer } from '@/utils/waitForServer';

// See specs/chunk-load-recovery.md
const RELOAD_KEY = 'chunkLoadReloaded';

 
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
          // The chunk may have failed because the server is down; a reload now
          // would land on the browser's error page. Wait until it answers.
          await waitForServer();
          sessionStorage.setItem(RELOAD_KEY, '1');
          window.location.reload();
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      }
    }
  });
}
