import { useSyncExternalStore } from 'react';
import { subscribe, getStatus, type SaveQueueStatus } from './saveQueue';

/**
 * Live view of the module-scope save queue (see specs/admin-save-queue.md).
 *
 * `useSyncExternalStore` rather than useState+useEffect: a save can complete
 * between render and effect, and this way that transition is never missed.
 * `getStatus` returns a cached snapshot whose identity only changes on a real
 * transition — that is a hard requirement of this hook, not an optimization.
 *
 * The retry countdown is deliberately absent from the snapshot: a value that
 * ticks every second would re-render every consumer. The indicator derives the
 * remaining seconds from `nextRetryAt` with its own interval.
 */
export function useSaveQueueStatus(): SaveQueueStatus {
  return useSyncExternalStore(subscribe, getStatus, getStatus);
}
