import { useEffect, useState } from 'react';
import { onWsOpen, sendWsControl, useWsChannel } from '@/services/useBackendSocket';
import { setInactiveShowTab, triggerReemit } from '@/services/showPresenceState';
import { emitCachedGamemasterState } from '@/hooks/useGamemasterSync';

interface ShowPresence {
  isActive: boolean;
  claim: () => void;
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
 * In prod, only one show tab is active at a time. Others see `isActive === false`
 * and should render a warning overlay; clicking `claim()` takes over.
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
    sendWsControl('show-register');
    emitCachedGamemasterState();
    const off = onWsOpen(() => {
      sendWsControl('show-register');
      emitCachedGamemasterState();
    });
    return () => { off(); };
  }, [isDev]);

  const claim = () => {
    if (isDev) return;
    sendWsControl('show-claim');
  };

  if (isDev) return { isActive: true, claim: () => undefined };
  return { isActive, claim };
}
