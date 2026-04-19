/**
 * Module-level flag tracking whether the current tab is a `/show` tab
 * that the server has marked inactive. Writers consult this to gate
 * broadcasts so that a background show tab never overwrites the active
 * show tab's authoritative state.
 *
 * Admin and gamemaster tabs never toggle this (they don't register
 * show-presence), so it stays false for them.
 *
 * A "became active" event is fired on the inactive → active transition
 * (user claims takeover, or server auto-promotes after the previously
 * active tab closed). Writers subscribe so they can re-emit their
 * current state — otherwise the server cache keeps the stale value
 * from the previous active tab until the new one mutates.
 */

let inactive = false;
const onBecameActiveListeners = new Set<() => void>();
const onReemitRequestListeners = new Set<() => void>();

export function setInactiveShowTab(value: boolean): void {
  const wasInactive = inactive;
  inactive = value;
  if (wasInactive && !inactive) {
    for (const fn of onBecameActiveListeners) {
      try { fn(); } catch { /* listener errors must not break others */ }
    }
  }
}

export function isInactiveShowTab(): boolean {
  return inactive;
}

export function onBecameActive(fn: () => void): () => void {
  onBecameActiveListeners.add(fn);
  return () => { onBecameActiveListeners.delete(fn); };
}

/**
 * Writers subscribe here to re-emit their current state on demand.
 * Fired when the server explicitly asks the active show to re-emit
 * (e.g. a new GM just connected and the server cache is empty).
 */
export function onReemitRequest(fn: () => void): () => void {
  onReemitRequestListeners.add(fn);
  return () => { onReemitRequestListeners.delete(fn); };
}

export function triggerReemit(): void {
  for (const fn of onReemitRequestListeners) {
    try { fn(); } catch { /* listener errors must not break others */ }
  }
}
