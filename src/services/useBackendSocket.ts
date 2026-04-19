/**
 * Singleton WebSocket connection to the backend push server.
 *
 * Usage in React components:
 *   useWsChannel<SystemStatusResponse>('system-status', (data) => { ... });
 *
 * The connection is lazily created when the first listener subscribes
 * and closed when the last listener unsubscribes.
 * Auto-reconnects with exponential backoff on disconnect.
 */

import { useEffect, useRef } from 'react';

type WsChannel =
  | 'yt-download-status'
  | 'audio-cover-status'
  | 'system-status'
  | 'asset-storage'
  | 'asset-duration'
  | 'assets-changed'
  | 'caches-cleared'
  | 'cache-started'
  | 'cache-ready';

type Listener = (data: unknown) => void;

// Module-level singleton state
const listeners = new Map<WsChannel, Set<Listener>>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 10000;
// Deferred close — lets React StrictMode's subscribe → cleanup → subscribe cycle complete
// without tearing down the (still-CONNECTING) WebSocket. Without this we'd log
// "WebSocket is closed before the connection is established" on every mount in dev.
let closeTimer: ReturnType<typeof setTimeout> | null = null;
const CLOSE_GRACE_MS = 100;

function getWsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/api/ws`;
}

function totalListenerCount(): number {
  let n = 0;
  for (const set of listeners.values()) n += set.size;
  return n;
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  // Skip in test environments (no real server to connect to)
  if (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === 'test') return;

  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    reconnectDelay = 1000; // reset backoff on successful connect
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as { channel: WsChannel; data: unknown };
      const channelListeners = listeners.get(msg.channel);
      if (channelListeners) {
        for (const fn of channelListeners) fn(msg.data);
      }
    } catch { /* ignore malformed messages */ }
  };

  ws.onclose = () => {
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror, which handles reconnection
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (totalListenerCount() === 0) return; // no listeners — don't reconnect
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (totalListenerCount() > 0) connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function subscribe(channel: WsChannel, fn: Listener): void {
  // A pending close from a prior unsubscribe is cancelled — the WS stays alive.
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(fn);
  // Connect if this is the first listener overall
  if (totalListenerCount() === 1) connect();
}

function unsubscribe(channel: WsChannel, fn: Listener): void {
  const set = listeners.get(channel);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) listeners.delete(channel);
  // Defer the close so StrictMode's synchronous re-subscribe can cancel it.
  if (totalListenerCount() === 0 && !closeTimer) {
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (totalListenerCount() > 0) return; // a listener re-subscribed in the meantime
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws) { ws.close(); ws = null; }
    }, CLOSE_GRACE_MS);
  }
}

/**
 * React hook: subscribe to a WebSocket channel.
 * The handler is called each time the server pushes data on that channel.
 */
export function useWsChannel<T>(channel: WsChannel, handler: (data: T) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const fn: Listener = (data) => handlerRef.current(data as T);
    subscribe(channel, fn);
    return () => unsubscribe(channel, fn);
  }, [channel]);
}
