import { useEffect, useState } from 'react';
import { onWsOpen, sendWsControl, useWsChannel } from '@/services/useBackendSocket';
import { setInactiveShowTab, triggerReemit } from '@/services/showPresenceState';
import { emitCachedGamemasterState } from '@/hooks/useGamemasterSync';

interface ShowPresence {
  isActive: boolean;
  claim: () => void;
}

const SHOW_TAB_ID_KEY = 'show-tab-id';
let cachedShowTabId: string | null = null;

/**
 * A stable identity for THIS show tab. Persisted in `sessionStorage`, so it
 * survives a reload of the same tab but is absent in a freshly-opened tab — the
 * signal the server uses to recognise "the active frontend is reloading" (same
 * id → reclaim its slot) vs "a different/background frontend connected"
 * (different id → stays inactive, never steals a running show).
 *
 * Always returns a non-empty value. `crypto.randomUUID()` isn't available on a
 * non-secure-context LAN (`http://192.168.…`), so we use a timestamp+random id
 * (uniqueness across a handful of tabs is more than enough). If sessionStorage
 * is unavailable the id is per-page-load (reload then degrades to a manual
 * claim, but a background tab still never steals).
 */
function getShowTabId(): string {
  if (cachedShowTabId) return cachedShowTabId;
  let id = '';
  try { id = sessionStorage.getItem(SHOW_TAB_ID_KEY) ?? ''; } catch { /* disabled storage */ }
  if (!id) {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try { sessionStorage.setItem(SHOW_TAB_ID_KEY, id); } catch { /* disabled storage */ }
  }
  cachedShowTabId = id;
  return id;
}

/**
 * Registers the current tab as a `/show` client with the server and
 * tracks whether it is the single authoritative active show.
 *
 * In dev builds (`import.meta.env.DEV`) the hook short-circuits:
 * `isActive` is always `true` and `claim` is a noop. Multiple Vite-served
 * show tabs during development must all behave normally — no overlay,
 * no write-gating.
 *
 * In prod, only one show tab is active at a time and **a running show is never
 * interrupted**: a newly-opened tab is told `isActive: false`, renders the
 * takeover overlay, and (combined with the write-gate in `showPresenceState`)
 * has ZERO impact on the gamemaster until the user clicks `claim()`.
 *
 * Seamless reload — the active tab reloading resumes control without a click,
 * even when an inactive background frontend is open — is handled via a **stable
 * per-tab id** (`getShowTabId`, persisted in sessionStorage) sent with every
 * `show-register`. The server recognises the reloading owner by matching id and
 * reclaims its slot, while a *different* frontend's id never matches so it can
 * only become active via an explicit `claim()`. See `server/ws.ts`
 * (`decideShowRegister`) and specs/cross-device-gamemaster.md.
 */
export function useShowPresence(): ShowPresence {
  const isDev = typeof import.meta !== 'undefined'
    && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

  const [isActive, setIsActive] = useState<boolean>(true);

  useWsChannel<{ isActive: boolean } | null>('show-presence', (data) => {
    if (isDev) return;
    if (data && typeof data.isActive === 'boolean') {
      setIsActive(data.isActive);
      setInactiveShowTab(!data.isActive);
    }
  });

  // Server asks the active show to re-emit (new GM connected, cache empty).
  useWsChannel<null>('show-reemit-request', () => {
    if (isDev) return;
    triggerReemit();
  });

  useEffect(() => {
    if (isDev) return;
    // Register as a show client on mount and on every reconnect.
    // Also re-emit the last-known gamemaster state from localStorage
    // immediately, so the GM sees up-to-date state within one WS
    // round-trip — before lazy-loaded game components finish mounting.
    const id = getShowTabId();
    sendWsControl('show-register', { id });
    emitCachedGamemasterState();
    const off = onWsOpen(() => {
      sendWsControl('show-register', { id });
      emitCachedGamemasterState();
    });
    return () => { off(); };
  }, [isDev]);

  const claim = () => {
    if (isDev) return;
    sendWsControl('show-claim', { id: getShowTabId() });
  };

  if (isDev) return { isActive: true, claim: () => undefined };
  return { isActive, claim };
}
