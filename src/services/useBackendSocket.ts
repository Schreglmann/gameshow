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
  | 'asset-storage';

type Listener = (data: unknown) => void;

// Module-level singleton state
const listeners = new Map<WsChannel, Set<Listener>>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 10000;

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
  // Close connection if no listeners remain
  if (totalListenerCount() === 0) {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { ws.close(); ws = null; }
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
