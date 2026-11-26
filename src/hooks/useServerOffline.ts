import { useEffect, useState } from 'react';
import { useWsConnected } from '@/services/useBackendSocket';

/**
 * True once the backend WebSocket has been down for at least `delayMs`, false
 * again as soon as it reconnects. The delay keeps short blips (a server restart
 * under the supervisor takes about a second) from flashing an indicator.
 *
 * The very first connect after page load counts as "down" too, so a page that
 * cannot reach the server at all also shows the indicator after the delay.
 * See specs/crash-recovery.md.
 */
export function useServerOffline(delayMs: number): boolean {
  const connected = useWsConnected();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (connected) {
      setOffline(false);
      return;
    }
    const timer = setTimeout(() => setOffline(true), delayMs);
    return () => clearTimeout(timer);
  }, [connected, delayMs]);

  return offline && !connected;
}
