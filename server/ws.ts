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
 *   gamemaster-controls         — game → gamemaster (controls + phase + gameIndex + tallyReadOnly);
 *                                 cached last-value
 *   gamemaster-command          — gamemaster → game (control commands); ephemeral, NOT cached
 *   gamemaster-team-state-v2       — any client → any client (team/joker state); cached last-value.
 *                                 VERSION-GUARDED: relayed only when the payload's Lamport
 *                                 `rev` beats the cached one (decideTeamStateWrite); a rejected
 *                                 writer gets the cached value back so it converges. A `null`
 *                                 payload resets the cache. See specs/cross-device-gamemaster.md.
 *   gamemaster-question-tally   — any client → any client (correct-answer tally, nested
 *                                 gameIndex → questionKey → counts); cached last-value.
 *                                 See specs/gamemaster-question-scores.md.
 *   music-state                 — active show → gamemaster (background-music snapshot); cached last-value
 *   music-command               — gamemaster → active show (music control commands); ephemeral, NOT cached
 *   show-presence               — server → individual show client ({ isActive })
 *   show-reemit-request         — server → active show (requests a state re-emit)
 *   gm-presence                 — server → all clients ({ connected: boolean }); cached last-value
 *   show-hold                   — gamemaster → show ({ active, message? }); panic/pause hold overlay; cached last-value
 *   show-controls-hidden        — gamemaster → show ({ hidden }); hide the show's own control buttons; cached last-value
 *   content-changed             — server → all clients; file watcher fired (config/theme/games changed on disk); NOT cached
 *
 * Client→server meta messages (not channels — ride on the same socket):
 *   { type: 'show-register', id } — show PWA announces itself on every connect. `id` is a
 *                                   stable per-tab id (sessionStorage) so the server can tell a
 *                                   reload of the active frontend (same id → reclaim its slot)
 *                                   from a different/background frontend (different id → stays
 *                                   inactive; never steals a running show). The owner id is
 *                                   persisted to `.show-presence.json`; for 15 s after a restart
 *                                   only that owner may auto-claim (specs/crash-recovery.md).
 *   { type: 'show-claim', id }    — show PWA explicitly takes over as the active show ("übernehmen")
 *   { type: 'gm-register' }       — gamemaster PWA announces itself on every connect
 *   { type: 'gm-request-reemit' } — gamemaster asks the active show to re-emit its
 *                                   current state (recovers a stale/desynced GM card);
 *                                   forwarded as a `show-reemit-request` to the active show
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import path from 'path';
import { readFileSync, renameSync, writeFileSync } from 'fs';

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
  | 'gamemaster-team-state-v2'
  | 'gamemaster-question-tally'
  | 'music-state'
  | 'music-command'
  | 'show-presence'
  | 'show-reemit-request'
  | 'gm-presence'
  | 'show-hold'
  | 'show-controls-hidden'
  | 'content-changed';

// Client→server control messages (not WsChannels — these are meta messages on the same socket).
type ClientControlType = 'show-register' | 'show-claim' | 'gm-register' | 'gm-request-reemit';

// Channels clients are allowed to write to (re-broadcast to all OTHER clients).
const CLIENT_WRITABLE: ReadonlySet<WsChannel> = new Set<WsChannel>([
  'gamemaster-answer',
  'gamemaster-controls',
  'gamemaster-command',
  'gamemaster-team-state-v2',
  'gamemaster-question-tally',
  'music-state',
  'music-command',
  'show-hold',
  'show-controls-hidden',
]);

// Channels the server caches last-value of (for late-joining clients).
const CACHED_CHANNELS: ReadonlySet<WsChannel> = new Set<WsChannel>([
  'gamemaster-answer',
  'gamemaster-controls',
  'gamemaster-team-state-v2',
  'gamemaster-question-tally',
  'music-state',
  'gm-presence',
  'show-hold',
  'show-controls-hidden',
]);

// Cached channels on which an identical re-broadcast is a pure echo and is
// dropped server-side (echo-storm guard). Excludes answer/controls, which rely
// on intentional identical re-emits for desync recovery. See handleClientMessage.
const ECHO_DEDUP_CHANNELS: ReadonlySet<WsChannel> = new Set<WsChannel>([
  'gamemaster-team-state-v2',
  'gamemaster-question-tally',
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
// when the active socket disconnects so the reload reconnecting reclaims it. It
// changes when a tab takes the slot (first show, lone tab, explicit `show-claim`)
// and is persisted to `.show-presence.json` so it also survives a server restart.
let activeShowId: string | null = null;
// Per-socket id map so a `show-claim` can look up the claimer's id.
const showClientIds = new WeakMap<WebSocket, string>();

// `activeShowId` survives a server restart in this sidecar, so after a crash the
// projector reclaims its slot instead of whichever show tab reconnects first.
// See specs/crash-recovery.md.
let showPresencePath = path.join(process.cwd(), '.show-presence.json');
// After a restart with a restored owner, other tabs may not auto-claim the slot
// until this deadline: longer than the client's 10 s maximum reconnect delay, so
// the owner gets a fair chance to come back first.
export const SHOW_RESTART_GRACE_MS = 15_000;
let restartGraceUntil = 0;

/** Reads the persisted owner id, or null when missing or malformed. */
export function loadShowPresence(file: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { activeShowId?: unknown };
    return typeof parsed.activeShowId === 'string' && parsed.activeShowId !== '' ? parsed.activeShowId : null;
  } catch {
    return null;
  }
}

/** Writes the owner id atomically (tmp + rename). Never throws. */
export function saveShowPresence(file: string, id: string | null): void {
  try {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ activeShowId: id }) + '\n');
    renameSync(tmp, file);
  } catch (e) {
    console.warn('[ws] could not persist show presence:', (e as Error).message);
  }
}

/** Overrides the sidecar path. Tests only. */
export function setShowPresencePathForTests(file: string): void {
  showPresencePath = file;
}

function setActiveShowId(id: string | null): void {
  if (id === activeShowId) return;
  activeShowId = id;
  saveShowPresence(showPresencePath, id);
}

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
 * - Within the restart grace window (owner restored from disk after a server
 *   restart), a DIFFERENT frontend never auto-claims the empty slot, even when it
 *   is alone — the owner is most likely still reconnecting. See specs/crash-recovery.md.
 * - Occupied slot + id matches owner → the owner reconnecting while a stale
 *   predecessor socket lingers (half-open reload) → take over.
 * - Occupied slot + different/empty id → ignore (never steal a running show).
 */
export function decideShowRegister(slotOccupied: boolean, ownerId: string | null, registeringId: string, hasOtherShowClients: boolean, withinRestartGrace = false): ShowRegisterDecision {
  if (!slotOccupied) {
    if (!ownerId) return 'claim';
    if (registeringId !== '' && registeringId === ownerId) return 'claim';
    if (withinRestartGrace) return 'ignore';
    if (registeringId !== '' && !hasOtherShowClients) return 'claim';
    return 'ignore';
  }
  return registeringId !== '' && registeringId === ownerId ? 'claim' : 'ignore';
}

/**
 * Lamport `rev` carried by a `gamemaster-team-state-v2` payload. Missing or
 * malformed counts as 0, so a client that predates the field can still make its
 * very first write into an empty cache but can never outrank a live show.
 */
export function teamStateRev(data: unknown): number {
  if (!data || typeof data !== 'object') return 0;
  const rev = (data as { rev?: unknown }).rev;
  return typeof rev === 'number' && Number.isFinite(rev) ? rev : 0;
}

/**
 * Pure decision: may this team-state write be cached and relayed?
 * `cachedRev` is null when nothing is cached yet (fresh boot / after a restart),
 * where any write is accepted — that is what lets the active show re-seed the
 * server. Otherwise the write must strictly beat what we hold: equal revs mean
 * two clients mutated concurrently from the same base, and first-write-wins is
 * what makes both of them converge (the loser is handed the cached value).
 */
export function decideTeamStateWrite(cachedRev: number | null, incomingRev: number): boolean {
  if (cachedRev === null) return true;
  return incomingRev > cachedRev;
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
  restoreShowPresence();
  const wss = new WebSocketServer({ server, path: '/api/ws' });
  // The ws server re-emits the HTTP server's errors (e.g. EADDRINUSE). Without a
  // listener that is an uncaught exception; the listen callback in index.ts
  // already handles it. See specs/crash-recovery.md.
  wss.on('error', (err) => {
    console.warn('[ws] server error:', err.message);
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    isAlive.set(ws, true);
    sendInitialState(ws);

    ws.on('pong', () => {
      isAlive.set(ws, true);
    });

    ws.on('message', (raw) => {
      // Defence in depth: no malformed or hostile frame from any connected
      // client may ever take the backend down during a live show.
      try {
        handleClientMessage(ws, raw);
      } catch (e) {
        console.warn('[ws] dropped a message that threw:', e);
      }
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
  let decoded: unknown;
  try {
    const text = typeof raw === 'string' ? raw : raw instanceof Buffer ? raw.toString('utf-8') : String(raw);
    decoded = JSON.parse(text);
  } catch {
    return;
  }
  // `JSON.parse` happily yields null / numbers / strings / arrays for a
  // well-formed frame like `null` or `42`. Reading `.type` off those threw a
  // TypeError out of the `message` handler and killed the whole backend
  // process — any connected client could do it. Anything that is not a plain
  // object carries no channel or control type, so drop it.
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return;
  const parsed = decoded as { channel?: string; type?: string; data?: unknown; id?: string };

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

    // Stale-write guard (team-state only). The dedup above stops an identical
    // re-send, but not an OLDER one: every PWA publishes the whole TeamState on
    // any local mutation, so a client that fell behind — a show re-seeding on
    // reconnect, a background tab claiming the slot, an installed PWA replaying
    // a previous session — used to be able to roll the live score back for
    // everyone, last-writer-wins. Each snapshot carries a Lamport `rev`; relay
    // one only if it beats the cached rev, and hand a rejected writer the
    // current value so it converges instead of the two diverging.
    // An explicit `null` payload is the cache RESET (tests/e2e/_helpers
    // `clearWsState`), not a snapshot — it bypasses the guard, and a cached
    // null counts as "nothing cached" so the next real write always lands.
    if (channel === 'gamemaster-team-state-v2' && parsed.data !== null) {
      const cached = channelCache.get(channel);
      const cachedRev = cached === undefined || cached === null ? null : teamStateRev(cached);
      if (!decideTeamStateWrite(cachedRev, teamStateRev(parsed.data))) {
        send(origin, channel, cached);
        return;
      }
    }
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
    if (decideShowRegister(activeShowWs !== null, activeShowId, id, hasOtherShowClients, Date.now() < restartGraceUntil) === 'claim') {
      const stale = activeShowWs;
      activeShowWs = origin;
      // The tab that now runs the show is the owner — also when it claimed a slot
      // whose previous owner is gone, so a later restart restores THIS tab.
      if (id) setActiveShowId(id);
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
    setActiveShowId(showClientIds.get(origin) ?? (id || null));
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

/**
 * Restores the owner id persisted before a restart and opens the grace window.
 * When the window ends with the slot still empty, the connected show tabs are
 * re-evaluated without the grace rule, so a lone spare tab still becomes active.
 */
function restoreShowPresence(): void {
  const restored = loadShowPresence(showPresencePath);
  if (!restored) return;
  activeShowId = restored;
  restartGraceUntil = Date.now() + SHOW_RESTART_GRACE_MS;
  console.log(`[ws] restored main show tab ${restored.slice(0, 8)}… — other tabs wait ${SHOW_RESTART_GRACE_MS / 1000} s`);
  setTimeout(() => {
    restartGraceUntil = 0;
    if (activeShowWs) return;
    const open = [...showClients].filter(ws => ws.readyState === WebSocket.OPEN);
    for (const ws of open) {
      const id = showClientIds.get(ws) ?? '';
      const hasOther = open.some(other => other !== ws);
      if (decideShowRegister(false, activeShowId, id, hasOther) === 'claim') {
        activeShowWs = ws;
        if (id) setActiveShowId(id);
        break;
      }
    }
    sendPresenceToAllShowClients();
  }, SHOW_RESTART_GRACE_MS).unref();
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
