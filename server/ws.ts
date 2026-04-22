/**
 * WebSocket push server — replaces client-side polling with server-pushed updates.
 *
 * Every channel is documented in `specs/api/asyncapi.yaml`. Any change here
 * MUST update that spec in the same commit — see AGENTS.md §2a (API contracts).
 *
 * Channels:
 *   yt-download-status          — YouTube download jobs (event-driven)
 *   audio-cover-status          — audio cover fetch jobs (event-driven)
 *   system-status               — server metrics, processes, NAS (periodic 2s)
 *   asset-storage               — storage mode + NAS mount (periodic 5s)
 *   asset-duration              — batched durations while admin enumerates a category
 *   assets-changed              — DAM mutations (upload, yt-download, move, delete, …)
 *   caches-cleared              — fired after POST /api/backend/caches/clear
 *   cache-started               — a segment encode has started
 *   cache-ready                 — a segment encode has finished
 *   gamemaster-answer           — game → gamemaster (current answer data); cached last-value
 *   gamemaster-controls         — game → gamemaster (controls + phase + gameIndex); cached last-value
 *   gamemaster-command          — gamemaster → game (control commands); ephemeral, NOT cached
 *   gamemaster-team-state       — any client → any client (team/joker state); cached last-value
 *   gamemaster-correct-answers  — any client → any client (tally map); cached last-value
 *   show-presence               — server → individual show client ({ isActive })
 *   show-reemit-request         — server → active show (requests a state re-emit)
 *
 * Client→server meta messages (not channels — ride on the same socket):
 *   { type: 'show-register' }   — show PWA announces itself on every connect
 *   { type: 'show-claim' }      — show PWA forces itself to become the active show
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

export type WsChannel =
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

// Client→server control messages (not WsChannels — these are meta messages on the same socket).
type ClientControlType = 'show-register' | 'show-claim';

// Channels clients are allowed to write to (re-broadcast to all OTHER clients).
const CLIENT_WRITABLE: ReadonlySet<WsChannel> = new Set<WsChannel>([
  'gamemaster-answer',
  'gamemaster-controls',
  'gamemaster-command',
  'gamemaster-team-state',
  'gamemaster-correct-answers',
]);

// Channels the server caches last-value of (for late-joining clients).
const CACHED_CHANNELS: ReadonlySet<WsChannel> = new Set<WsChannel>([
  'gamemaster-answer',
  'gamemaster-controls',
  'gamemaster-team-state',
  'gamemaster-correct-answers',
]);

export interface WsGetters {
  getYtDownloadStatus: () => unknown;
  getAudioCoverStatus: () => unknown;
  buildSystemStatus: () => Promise<unknown>;
  getAssetStorage: () => unknown;
}

const clients = new Set<WebSocket>();
let getters: WsGetters;

// Throttle state: channel → last broadcast timestamp
const lastBroadcastAt = new Map<WsChannel, number>();

// Server-side last-value cache for CACHED_CHANNELS
const channelCache = new Map<WsChannel, unknown>();

// Show-presence state
const showClients = new Set<WebSocket>();
let activeShowWs: WebSocket | null = null;

// Heartbeat state: which clients responded to the last ping. Without this
// a TCP-level half-open connection (WiFi drop, laptop sleep, SIGKILLed tab)
// can linger in `clients`/`showClients` for the TCP retransmission timeout
// (~1 minute) — blocking commands and pinning `activeShowWs` to a phantom.
const isAlive = new WeakMap<WebSocket, boolean>();

export function setupWebSocket(server: Server, g: WsGetters): void {
  getters = g;
  const wss = new WebSocketServer({ server, path: '/api/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    isAlive.set(ws, true);
    sendInitialState(ws);

    ws.on('pong', () => {
      isAlive.set(ws, true);
    });

    ws.on('message', (raw) => {
      handleClientMessage(ws, raw);
    });

    ws.on('close', () => {
      clients.delete(ws);
      handleShowDisconnect(ws);
    });
    ws.on('error', () => {
      clients.delete(ws);
      handleShowDisconnect(ws);
    });
  });

  // Heartbeat: every 10s, ping every client. Any client that didn't pong
  // since the last tick is assumed dead and gets terminated — which fires
  // the `close` handler, which cleans up showClients and promotes the next
  // active show.
  setInterval(() => {
    for (const ws of clients) {
      if (isAlive.get(ws) === false) {
        try { ws.terminate(); } catch { /* ignore */ }
        continue;
      }
      isAlive.set(ws, false);
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, 10000);

  // Periodic broadcasts (only when clients connected)
  setInterval(async () => {
    if (clients.size === 0) return;
    try {
      const data = await getters.buildSystemStatus();
      send(clients, 'system-status', data);
    } catch { /* ignore build errors */ }
  }, 2000);

  setInterval(() => {
    if (clients.size === 0) return;
    send(clients, 'asset-storage', getters.getAssetStorage());
  }, 5000);
}

export function wsClientCount(): number {
  return clients.size;
}

/** Broadcast to all connected clients (immediate). */
export function broadcast(channel: WsChannel, data: unknown): void {
  if (clients.size === 0) return;
  send(clients, channel, data);
}

/** Broadcast to all connected clients, throttled to at most once per `minMs`. */
export function broadcastThrottled(channel: WsChannel, data: unknown, minMs: number): void {
  if (clients.size === 0) return;
  const now = Date.now();
  const last = lastBroadcastAt.get(channel) ?? 0;
  if (now - last < minMs) return;
  lastBroadcastAt.set(channel, now);
  send(clients, channel, data);
}

// ── Client→server message handling ──

function handleClientMessage(origin: WebSocket, raw: unknown): void {
  let parsed: { channel?: string; type?: string; data?: unknown };
  try {
    const text = typeof raw === 'string' ? raw : raw instanceof Buffer ? raw.toString('utf-8') : String(raw);
    parsed = JSON.parse(text);
  } catch {
    return;
  }

  // Meta control messages: { type: 'show-register' | 'show-claim' }
  if (parsed.type) {
    handleControlMessage(origin, parsed.type as ClientControlType);
    return;
  }

  // Channel message: { channel, data }
  const channel = parsed.channel as WsChannel | undefined;
  if (!channel || !CLIENT_WRITABLE.has(channel)) return;

  // Update cache for cached channels
  if (CACHED_CHANNELS.has(channel)) {
    channelCache.set(channel, parsed.data);
  }

  // Re-broadcast to all OTHER clients (skip origin).
  const msg = JSON.stringify({ channel, data: parsed.data });
  for (const client of clients) {
    if (client === origin) continue;
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function handleControlMessage(origin: WebSocket, type: ClientControlType): void {
  if (type === 'show-register') {
    showClients.add(origin);
    if (!activeShowWs) {
      activeShowWs = origin;
    }
    sendPresenceToAllShowClients();
  } else if (type === 'show-claim') {
    if (!showClients.has(origin)) showClients.add(origin);
    activeShowWs = origin;
    sendPresenceToAllShowClients();
  }
}

function handleShowDisconnect(ws: WebSocket): void {
  if (!showClients.has(ws)) return;
  showClients.delete(ws);
  if (activeShowWs === ws) {
    // Auto-promote another registered show client, if any.
    activeShowWs = null;
    for (const candidate of showClients) {
      if (candidate.readyState === WebSocket.OPEN) {
        activeShowWs = candidate;
        break;
      }
    }
    sendPresenceToAllShowClients();
  }
  // NB: the gamemaster-* cache is deliberately NOT cleared on disconnect.
  // On a reload the new show mounts and emits in a few seconds — if we
  // cleared the cache we'd flash the GM back to its waiting state in the
  // meantime. The stale value is always overwritten by the new active
  // show's first emit (or by show-reemit-request on the next connect).
}

function sendPresenceToAllShowClients(): void {
  for (const ws of showClients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const isActive = ws === activeShowWs;
    send(ws, 'show-presence', { isActive });
  }
}

// ── Internal helpers ──

function send(targets: Set<WebSocket> | WebSocket, channel: WsChannel, data: unknown): void {
  const msg = JSON.stringify({ channel, data });
  if (targets instanceof WebSocket) {
    if (targets.readyState === WebSocket.OPEN) targets.send(msg);
  } else {
    for (const ws of targets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }
}

function sendInitialState(ws: WebSocket): void {
  try {
    // Synchronous sends first — including cached gamemaster state — so a
    // freshly-opened GM tab sees the current answer/controls/teams
    // immediately, not blocked on slow filesystem scans below.
    send(ws, 'yt-download-status', getters.getYtDownloadStatus());
    send(ws, 'audio-cover-status', getters.getAudioCoverStatus());
    send(ws, 'asset-storage', getters.getAssetStorage());
    for (const channel of CACHED_CHANNELS) {
      if (channelCache.has(channel)) {
        send(ws, channel, channelCache.get(channel));
      }
    }
  } catch { /* ignore errors during initial state push */ }

  // Ask the active show to re-emit its current state. This covers the
  // server-just-restarted case (cache empty on both sides) and guarantees
  // that a freshly-connected client (GM reload, new GM opens) always sees
  // the current state within one round-trip, not whenever the frontend
  // happens to mutate next.
  if (activeShowWs && activeShowWs !== ws && activeShowWs.readyState === WebSocket.OPEN) {
    send(activeShowWs, 'show-reemit-request', null);
  }

  // system-status is async (filesystem / process enumeration, can take
  // seconds on cold cache). Fire-and-forget — never block the rest of the
  // initial-state burst on it.
  getters.buildSystemStatus().then(
    (sysStatus) => send(ws, 'system-status', sysStatus),
    () => { /* ignore */ },
  );
}
