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
 *   music-state                 — active show → gamemaster (background-music snapshot); cached last-value
 *   music-command               — gamemaster → active show (music control commands); ephemeral, NOT cached
 *   show-presence               — server → individual show client ({ isActive })
 *   show-reemit-request         — server → active show (requests a state re-emit)
 *   gm-presence                 — server → all clients ({ connected: boolean }); cached last-value
 *   show-hold                   — gamemaster → show ({ active, message? }); panic/pause hold overlay; cached last-value
 *   content-changed             — server → all clients; file watcher fired (config/theme/games changed on disk); NOT cached
 *
 * Client→server meta messages (not channels — ride on the same socket):
 *   { type: 'show-register', id } — show PWA announces itself on every connect. `id` is a
 *                                   stable per-tab id (sessionStorage) so the server can tell a
 *                                   reload of the active frontend (same id → reclaim its slot)
 *                                   from a different/background frontend (different id → stays
 *                                   inactive; never steals a running show).
 *   { type: 'show-claim', id }    — show PWA explicitly takes over as the active show ("übernehmen")
 *   { type: 'gm-register' }       — gamemaster PWA announces itself on every connect
 *   { type: 'gm-request-reemit' } — gamemaster asks the active show to re-emit its
 *                                   current state (recovers a stale/desynced GM card);
 *                                   forwarded as a `show-reemit-request` to the active show
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
  | 'music-state'
  | 'music-command'
  | 'show-presence'
  | 'show-reemit-request'
  | 'gm-presence'
  | 'show-hold'
  | 'content-changed';

// Client→server control messages (not WsChannels — these are meta messages on the same socket).
type ClientControlType = 'show-register' | 'show-claim' | 'gm-register' | 'gm-request-reemit';

// Channels clients are allowed to write to (re-broadcast to all OTHER clients).
const CLIENT_WRITABLE: ReadonlySet<WsChannel> = new Set<WsChannel>([
  'gamemaster-answer',
  'gamemaster-controls',
  'gamemaster-command',
  'gamemaster-team-state',
  'gamemaster-correct-answers',
  'music-state',
  'music-command',
  'show-hold',
]);

// Channels the server caches last-value of (for late-joining clients).
const CACHED_CHANNELS: ReadonlySet<WsChannel> = new Set<WsChannel>([
  'gamemaster-answer',
  'gamemaster-controls',
  'gamemaster-team-state',
  'gamemaster-correct-answers',
  'music-state',
  'gm-presence',
  'show-hold',
]);

// Cached channels on which an identical re-broadcast is a pure echo and is
// dropped server-side (echo-storm guard). Excludes answer/controls, which rely
// on intentional identical re-emits for desync recovery. See handleClientMessage.
const ECHO_DEDUP_CHANNELS: ReadonlySet<WsChannel> = new Set<WsChannel>([
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
// Serialized form of the last CLIENT-written cached value per channel, used to
// drop identical re-broadcasts (echo-storm guard in handleClientMessage).
const channelCacheJson = new Map<WsChannel, string>();

// Show-presence state
const showClients = new Set<WebSocket>();
let activeShowWs: WebSocket | null = null;
// Stable per-tab id of the frontend that owns the active slot. Sent by the show
// on `show-register` and persisted in the tab's sessionStorage, so it survives a
// reload but differs between tabs. This is how the server tells "the active
// frontend is reloading" (same id → reclaim) apart from "a different/background
// frontend connected" (different id → stays inactive, never steals). Retained
// when the active socket disconnects so the reload reconnecting reclaims it; only
// changes on an explicit `show-claim` (or the first show ever).
let activeShowId: string | null = null;
// Per-socket id map so a `show-claim` can look up the claimer's id.
const showClientIds = new WeakMap<WebSocket, string>();

export type ShowRegisterDecision = 'claim' | 'ignore';

/**
 * Pure decision: should a registering show tab become the active show?
 * - Empty slot + no owner ever → first show claims it.
 * - Empty slot owned by THIS frontend (id matches) → the owner reloading reclaims.
 * - Empty slot owned by a DIFFERENT frontend, but NO other show client is
 *   connected → claim. `activeShowId` is retained across the owning socket's
 *   disconnect (for seamless reload), so a tab opened later with a fresh
 *   sessionStorage id would otherwise be stranded behind the takeover overlay
 *   even though there is no running/background show to protect. When this tab is
 *   the only frontend, there is nothing to steal — it claims.
 * - Empty slot owned by a DIFFERENT frontend WHILE another show client is
 *   connected → ignore (a background/new frontend must not silently become main
 *   when an inactive sibling is present — requires explicit claim).
 * - Empty registering id never auto-claims an owned slot (degraded storage →
 *   manual claim is the intended fallback).
 * - Occupied slot + id matches owner → the owner reconnecting while a stale
 *   predecessor socket lingers (half-open reload) → take over.
 * - Occupied slot + different/empty id → ignore (never steal a running show).
 */
export function decideShowRegister(slotOccupied: boolean, ownerId: string | null, registeringId: string, hasOtherShowClients: boolean): ShowRegisterDecision {
  if (!slotOccupied) {
    if (!ownerId) return 'claim';
    if (registeringId !== '' && registeringId === ownerId) return 'claim';
    if (registeringId !== '' && !hasOtherShowClients) return 'claim';
    return 'ignore';
  }
  return registeringId !== '' && registeringId === ownerId ? 'claim' : 'ignore';
}

// Gamemaster-presence state. Tracks every connected GM PWA so the show can
// decide whether to surface in-frontend recovery UI (when no GM is connected
// the show is the only place a recovery button can live).
const gmClients = new Set<WebSocket>();

// Heartbeat state: which clients responded to the last ping. Without this
// a TCP-level half-open connection (WiFi drop, laptop sleep, SIGKILLed tab)
// can linger in `clients`/`showClients` for the TCP retransmission timeout
// (~1 minute) — blocking commands and pinning `activeShowWs` to a phantom.
const isAlive = new WeakMap<WebSocket, boolean>();

export function setupWebSocket(server: Server, g: WsGetters): void {
  getters = g;
  // Seed gm-presence so the first show client connecting before any GM has
  // ever registered still receives an explicit "GM absent" signal.
  channelCache.set('gm-presence', { connected: false });
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
      handleGmDisconnect(ws);
    });
    ws.on('error', () => {
      clients.delete(ws);
      handleShowDisconnect(ws);
      handleGmDisconnect(ws);
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
  let parsed: { channel?: string; type?: string; data?: unknown; id?: string };
  try {
    const text = typeof raw === 'string' ? raw : raw instanceof Buffer ? raw.toString('utf-8') : String(raw);
    parsed = JSON.parse(text);
  } catch {
    return;
  }

  // Meta control messages: { type: 'show-register' | 'show-claim' | …, id? }
  if (parsed.type) {
    handleControlMessage(origin, parsed.type as ClientControlType, typeof parsed.id === 'string' ? parsed.id : '');
    return;
  }

  // Channel message: { channel, data }
  const channel = parsed.channel as WsChannel | undefined;
  if (!channel || !CLIENT_WRITABLE.has(channel)) return;

  // Echo-storm guard (server-side, version-independent). For the high-churn
  // STATE channels, drop a write whose value is identical to the current cached
  // value: it carries no new information (every connected client already has it,
  // and a late joiner gets the cache on connect). Without this, two tabs that
  // each re-broadcast state they just received ping-pong forever, flooding the
  // relay and every client (iPad over WiFi worst-hit: ~30s lag, and stale echoes
  // clobbering fresh awards back to 0). Crucially this protects even when the
  // CLIENTS are stale/cached (an installed PWA a dev-server restart can't update)
  // — the loop is broken at the relay.
  // Scoped to team-state + correct-answers: the answer/controls channels use a
  // re-emit-on-desync recovery flow (specs/cross-device-gamemaster.md) where an
  // identical re-send is intentional, so they must NOT be deduped.
  if (ECHO_DEDUP_CHANNELS.has(channel)) {
    const dataJson = JSON.stringify(parsed.data);
    if (dataJson === channelCacheJson.get(channel)) return;
    channelCacheJson.set(channel, dataJson);
  }

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

function handleControlMessage(origin: WebSocket, type: ClientControlType, id: string = ''): void {
  if (type === 'show-register') {
    showClients.add(origin);
    if (id) showClientIds.set(origin, id);
    // Identity-based election (never interrupt a running show; a reload of the
    // owning frontend reclaims its own slot — see decideShowRegister). `origin`
    // is already in `showClients`, so "other" = any OTHER open show socket; when
    // there are none, an alone tab claims rather than stranding behind the overlay.
    const hasOtherShowClients = [...showClients].some(ws => ws !== origin && ws.readyState === WebSocket.OPEN);
    if (decideShowRegister(activeShowWs !== null, activeShowId, id, hasOtherShowClients) === 'claim') {
      const stale = activeShowWs;
      activeShowWs = origin;
      if (!activeShowId) activeShowId = id || null;
      // Retire a lingering predecessor socket of the SAME frontend (half-open
      // reload) so it doesn't sit around until the heartbeat reaps it.
      if (stale && stale !== origin && stale.readyState === WebSocket.OPEN) {
        try { stale.terminate(); } catch { /* ignore */ }
      }
    }
    // else: a different/background frontend → stays inactive (overlay).
    sendPresenceToAllShowClients();
  } else if (type === 'show-claim') {
    // Explicit operator takeover ("übernehmen"): this frontend becomes the owner.
    if (!showClients.has(origin)) showClients.add(origin);
    if (id) showClientIds.set(origin, id);
    activeShowWs = origin;
    activeShowId = showClientIds.get(origin) ?? id ?? null;
    sendPresenceToAllShowClients();
  } else if (type === 'gm-register') {
    const wasEmpty = gmClients.size === 0;
    gmClients.add(origin);
    if (wasEmpty) broadcastGmPresence();
  } else if (type === 'gm-request-reemit') {
    // A GM detected a stale/desynced card and wants the truth. Ask the active
    // show to re-emit its current answer/controls (same path the server uses on
    // every new connection). No-op if no active show is currently registered.
    if (activeShowWs && activeShowWs.readyState === WebSocket.OPEN) {
      send(activeShowWs, 'show-reemit-request', null);
    }
  }
}

function handleShowDisconnect(ws: WebSocket): void {
  if (!showClients.has(ws)) return;
  showClients.delete(ws);
  if (activeShowWs === ws) {
    // The active show is gone. Clear the socket but KEEP `activeShowId` (the
    // owning frontend's identity) and DO NOT auto-promote a background show
    // client: a frontend the operator left in the "nicht aktiv" state must never
    // silently become the main show. The empty slot is reclaimed by whichever
    // show registers next whose id matches `activeShowId` — a reloading main
    // reconnects within a second or two and reclaims it via decideShowRegister,
    // so its control survives the reload even when an inactive background
    // frontend is open. A genuine takeover by a DIFFERENT frontend requires an
    // explicit `show-claim` ("übernehmen").
    activeShowWs = null;
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

function handleGmDisconnect(ws: WebSocket): void {
  if (!gmClients.has(ws)) return;
  gmClients.delete(ws);
  if (gmClients.size === 0) broadcastGmPresence();
}

function broadcastGmPresence(): void {
  const data = { connected: gmClients.size > 0 };
  channelCache.set('gm-presence', data);
  send(clients, 'gm-presence', data);
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
