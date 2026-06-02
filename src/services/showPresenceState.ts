/**
 * Module-level flag tracking whether the current tab is a `/show` tab
 * that is NOT allowed to broadcast authoritative gamemaster state. Writers
 * consult this to gate broadcasts so that a background / not-yet-confirmed
 * show tab never overwrites the active show tab's state.
 *
 * Admin and gamemaster tabs never toggle this (they don't register
 * show-presence), so it stays at its initial value for them.
 *
 * **Default: a prod show tab starts GATED (inactive=true).** A freshly-opened
 * show tab must emit NOTHING to the gamemaster until the server confirms it is
 * the active show via `show-presence { isActive: true }`. Without this, a second
 * frontend opened while a game is running would push its own state to the GM in
 * the window between mounting (child `useGamemasterSync` emit effects run before
 * the parent `useShowPresence` effect learns presence) and receiving
 * `{ isActive: false }` — clobbering the GM card even though the tab shows the
 * "nicht aktiv" overlay. The decision is made at module load (before any effect)
 * so the gate is already closed when the first emit effect fires.
 *
 * Non-show tabs (GM/admin) and ALL dev tabs start ungated — the GM/admin
 * legitimately broadcast team/correct-answers state, and dev treats every show
 * tab as active (no overlay, no write-gating).
 *
 * A "became active" event is fired on the inactive → active transition
 * (server confirms this tab is active: sole show, claim, or auto-promote).
 * Writers subscribe so they can re-emit their current state — otherwise the
 * server cache keeps the stale value from the previous active tab.
 */

/**
 * Compute the initial gate state at module load. Pure for testability.
 * - dev: never gated (every show tab acts active).
 * - prod show tab (`/show…`): gated until the server confirms active.
 * - prod non-show tab (GM/admin) or no DOM: not gated.
 */
export function computeInitialInactive(isDev: boolean, pathname: string | undefined): boolean {
  if (isDev) return false;
  if (!pathname) return false;
  return pathname.startsWith('/show');
}

let inactive = computeInitialInactive(
  typeof import.meta !== 'undefined'
    && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true,
  typeof window !== 'undefined' ? window.location.pathname : undefined,
);
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
