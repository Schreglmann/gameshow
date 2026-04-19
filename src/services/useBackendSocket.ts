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
  | 'cache-ready'
  | 'gamemaster-answer'
  | 'gamemaster-controls'
  | 'gamemaster-command'
  | 'gamemaster-team-state'
  | 'gamemaster-correct-answers'
  | 'show-presence'
  | 'show-reemit-request';

type Listener = (data: unknown) => void;
type OpenListener = () => void;

// Module-level singleton state
const listeners = new Map<WsChannel, Set<Listener>>();
const openListeners = new Set<OpenListener>();
// Client-side cache: last message per channel. Late subscribers replay from this
// immediately — without it, a listener that mounts after the WS has already
// delivered the server's initial-state burst would miss it entirely.
const lastByChannel = new Map<WsChannel, unknown>();
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

// Anyone subscribed to the socket in any form keeps it alive.
function anySubscribers(): boolean {
  return totalListenerCount() > 0 || openListeners.size > 0;
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  // Skip in test environments (no real server to connect to)
  if (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === 'test') return;

  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    reconnectDelay = 1000; // reset backoff on successful connect
    for (const fn of openListeners) {
      try { fn(); } catch { /* one listener's failure must not break the rest */ }
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as { channel: WsChannel; data: unknown };
      lastByChannel.set(msg.channel, msg.data);
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
  if (!anySubscribers()) return; // no listeners — don't reconnect
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (anySubscribers()) connect();
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
  const wasEmpty = !anySubscribers();
  set.add(fn);
  // Replay last cached value immediately so a listener that mounted after the
  // server's initial-state burst still sees the current state.
  if (lastByChannel.has(channel)) {
    try { fn(lastByChannel.get(channel)); } catch { /* listener errors must not break subscribe */ }
  }
  if (wasEmpty) connect();
}

function unsubscribe(channel: WsChannel, fn: Listener): void {
  const set = listeners.get(channel);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) listeners.delete(channel);
  scheduleDeferredClose();
}

function subscribeOpen(fn: OpenListener): void {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  const wasEmpty = !anySubscribers();
  openListeners.add(fn);
  if (wasEmpty) connect();
}

function unsubscribeOpen(fn: OpenListener): void {
  openListeners.delete(fn);
  scheduleDeferredClose();
}

function scheduleDeferredClose(): void {
  // Defer the close so StrictMode's synchronous re-subscribe can cancel it.
  if (!anySubscribers() && !closeTimer) {
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (anySubscribers()) return; // a listener re-subscribed in the meantime
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws) { ws.close(); ws = null; }
    }, CLOSE_GRACE_MS);
  }
}

/**
 * Send a message on a channel to the server. Server validates and
 * re-broadcasts to all OTHER connected clients. Drops if socket is
 * not OPEN — relies on `onWsOpen` + caller's state-emit-on-reconnect
 * pattern for recovery.
 */
export function sendWs(channel: WsChannel, data: unknown): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ channel, data }));
  } catch { /* drop */ }
}

/**
 * Send a meta control message on the socket (not a channel re-broadcast).
 * Used for show-presence registration / claim.
 */
export function sendWsControl(type: 'show-register' | 'show-claim'): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type }));
  } catch { /* drop */ }
}

/**
 * Register a callback fired each time the WS connection opens
 * (initial connect and every reconnect). Used by writers to re-seed
 * server-side last-value cache after server restart.
 */
export function onWsOpen(fn: OpenListener): () => void {
  subscribeOpen(fn);
  return () => unsubscribeOpen(fn);
}

/**
 * Test helper: synthesize a message on the given channel. Calls all
 * subscribed listeners with the provided data as if the server had
 * pushed it. Only intended for use from vitest — the WS singleton
 * otherwise short-circuits in `MODE === 'test'` and would never deliver.
 */
export function __emitChannelForTests(channel: WsChannel, data: unknown): void {
  lastByChannel.set(channel, data);
  const channelListeners = listeners.get(channel);
  if (!channelListeners) return;
  for (const fn of channelListeners) fn(data);
}

/** Test helper: clear the client-side last-value cache between tests. */
export function __clearWsCacheForTests(): void {
  lastByChannel.clear();
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

/**
 * React hook: subscribe to the WS `onopen` event.
 * Handler fires on initial connect and every reconnect.
 */
export function useWsOpen(handler: () => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const fn: OpenListener = () => handlerRef.current();
    subscribeOpen(fn);
    return () => unsubscribeOpen(fn);
  }, []);
}
