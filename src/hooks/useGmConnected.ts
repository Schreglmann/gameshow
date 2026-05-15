import { useState } from 'react';
import { useWsChannel } from '@/services/useBackendSocket';

/**
 * Tracks whether at least one gamemaster PWA is currently connected.
 *
 * The server seeds the `gm-presence` channel with `{ connected: false }` at
 * startup, broadcasts `{ connected: true }` when the first GM registers, and
 * `{ connected: false }` when the last GM disconnects. Late-joining clients
 * receive the cached current value on connect.
 *
 * Used by the show frontend to decide whether to render fallback recovery UI
 * (e.g. the "Asset neu laden" button) inline. When a GM is connected, the
 * recovery UI lives on the gamemaster screen instead.
 */
export function useGmConnected(): boolean {
  const [connected, setConnected] = useState<boolean>(false);
  useWsChannel<{ connected: boolean } | null>('gm-presence', (data) => {
    if (data && typeof data.connected === 'boolean') {
      setConnected(data.connected);
    }
  });
  return connected;
}
