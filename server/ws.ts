/**
 * WebSocket push server — replaces client-side polling with server-pushed updates.
 *
 * Channels:
 *   yt-download-status — YouTube download jobs (event-driven)
 *   audio-cover-status — audio cover fetch jobs (event-driven)
 *   system-status      — server metrics, processes, NAS (periodic 2s)
 *   asset-storage      — storage mode + NAS mount (periodic 5s)
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

export type WsChannel =
  | 'yt-download-status'
  | 'audio-cover-status'
  | 'system-status'
  | 'asset-storage';

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

export function setupWebSocket(server: Server, g: WsGetters): void {
  getters = g;
  const wss = new WebSocketServer({ server, path: '/api/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    sendInitialState(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

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

async function sendInitialState(ws: WebSocket): Promise<void> {
  try {
    // Send all channels immediately so the client has current state
    send(ws, 'yt-download-status', getters.getYtDownloadStatus());
    send(ws, 'audio-cover-status', getters.getAudioCoverStatus());
    send(ws, 'asset-storage', getters.getAssetStorage());
    // system-status is async (involves filesystem stats)
    const sysStatus = await getters.buildSystemStatus();
    send(ws, 'system-status', sysStatus);
  } catch { /* ignore errors during initial state push */ }
}
