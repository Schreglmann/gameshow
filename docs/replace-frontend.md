# Replacing the frontend (show) PWA

This document tells you exactly what contract a drop-in replacement of the show PWA must implement. The show PWA is the player-facing surface served at `/show/` — it renders the active game, team randomization, team points, background music, and all 12 game types.

A replacement can be built in any technology as long as it speaks the HTTP + WebSocket contract described here. The backend makes no assumption about framework or build tool.

## What the show PWA does

- Shows the landing screen with team assignment and (optionally) team randomization.
- Shows the global rules screen.
- Renders the current game via `GameFactory` → one of 12 game components.
- Owns the joker bar, music panel, timer, lightbox, and end-of-game summary.
- Emits live state to the gamemaster over WebSocket: current answer card, current controls, team state, correct-answer tallies.
- Responds to gamemaster commands (`next`, `award`, `use-joker`, …).

The show PWA is the only PWA that participates in the **active-show protocol**: multiple show tabs can connect, but only one is the authoritative "active show" at a time. Inactive shows drop their own writes to the cached gamemaster channels so they don't corrupt what the gamemaster sees.

## Required HTTP endpoints

All return `application/json` unless noted. Full schemas: [openapi.yaml](../specs/api/openapi.yaml).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/settings` | Global settings for the active gameshow (point system, rules, jokers, clean-install flag). |
| `GET` | `/api/theme` | Current theme names for frontend + admin. |
| `PUT` | `/api/theme` | Partial theme update (show PWA writes `frontend` key). |
| `GET` | `/api/game/:index` | Resolve `gameOrder[index]` → full `GameConfig` + navigation metadata. |
| `GET` | `/api/background-music` | List of MP3 filenames for the music panel. Optional `?theme=` filter. |
| `GET` | `/api/video-hdr?path=<asset>` | `{ isHdr: boolean }` — decides whether to stream from `/videos-sdr` (HDR source) or `/videos-compressed` (non-HDR). |
| `POST` | `/api/backend/stream-notify` | Body `{ active: boolean }`. Called on every video/audio play+pause so the server throttles background work. (Historical path prefix — this IS a frontend endpoint.) |
| `GET` | `/videos-compressed/:start/:end/:path` | Range-GET H.264 SDR segment stream. |
| `GET` | `/videos-sdr/:start/:end/:path` | Range-GET HDR→SDR tone-mapped segment stream. |
| `GET` | `/local-assets/**` | Raw asset files (images, audio, videos, background-music, bandle-audio). |

## Required WebSocket channels

One socket at `/api/ws`. Wire format: `{ channel, data }` for payloads, `{ type }` for meta. Full schemas: [asyncapi.yaml](../specs/api/asyncapi.yaml).

### Subscribe to (receive)

| Channel | Cached on server? | Purpose |
|---------|-------------------|---------|
| `show-presence` | no | Targeted to this socket. `{ isActive: boolean }` says whether this tab is the authoritative show. |
| `show-reemit-request` | no | Server asks the active show to re-emit its cached state (after reconnects). |
| `gamemaster-command` | no | Commands emitted by the gamemaster (`next`, `award`, `use-joker`, …). |
| `gamemaster-team-state` | yes | Team members + points + joker usage changes pushed by any other PWA. |
| `gamemaster-correct-answers` | yes | Correct-answer tally changes pushed by any other PWA. |

### Publish to (send)

| Channel | Cached? | When to send |
|---------|---------|--------------|
| `gamemaster-answer` | yes | Whenever the visible answer card changes (or `null` when no question is active). Inactive shows must NOT send. |
| `gamemaster-controls` | yes | Whenever available controls / phase / gameIndex change. Inactive shows must NOT send. |
| `gamemaster-team-state` | yes | On every team state mutation (joker used, points changed, roster edited locally). |
| `gamemaster-correct-answers` | yes | On every correct-answer tally mutation. |

### Meta messages (send)

| Type | When to send |
|------|--------------|
| `{ type: 'show-register' }` | Immediately on every WebSocket connect. Registers this tab as a show client. Server decides whether it's the active show. |
| `{ type: 'show-claim' }` | When the user clicks "take over" on a secondary show tab. Forces this tab to become active. |

## Active-show protocol in detail

Whenever `show-presence.isActive === false`, this show must:
- Drop its own writes to `gamemaster-answer` and `gamemaster-controls` (they would overwrite the active show's cached value).
- Still render everything locally as usual (so the user can "take over" and see the right state).
- Stop writing to `localStorage` keys that mirror WS cache, so the active show's state wins on refresh.

When transitioning from `isActive: false` → `true` (via `show-claim` or auto-promotion after the previous active show disconnects), immediately re-emit:
- current `gamemaster-answer`
- current `gamemaster-controls`

This repopulates the server cache with this show's state rather than leaving the gamemaster staring at the previous active show's stale values.

## State persistence

The reference implementation writes these keys to `localStorage`:

| Key | Shape | Purpose |
|-----|-------|---------|
| `gameshow:teams` | `TeamState` | Team roster + points. Survives reload. |
| `gameshow:currentGame` | `CurrentGame` | `{ currentIndex, totalGames }` — which game is active. |
| `gm:last-answer` | `GamemasterAnswerData` | Last emitted answer card (used for instant-paint on reload before the WS reconnects). |
| `gm:last-controls` | `GamemasterControlsData` | Same as above for controls. |
| `gm:correct-answers` | `Record<gameIndex, Record<teamId, number>>` | Correct-answer tallies. Mirrored to WS cache. |

A replacement is free to pick different keys but must not leak admin-specific state into show localStorage (they share the same origin).

## Build & serve contract

- **Mount point**: `/show/` (set `base: "/show/"` in your build tool).
- **Service worker scope**: `/show/` — disjoint from `/admin/` and `/gamemaster/` so each PWA installs separately.
- **Web app manifest**: `manifest.webmanifest` linked from `show/index.html`. `start_url: "/show/"`, `scope: "/show/"`, `display: "standalone"`.
- **Build output**: static files under `dist/client/show/` (or equivalent) served by the same Express process (no separate web server needed).

## Example: minimal flow

```ts
// 1. On mount, read settings + first game.
const settings = await fetch('/api/settings').then(r => r.json());
const game0 = await fetch('/api/game/0').then(r => r.json());

// 2. Open WS and announce as a show client.
const ws = new WebSocket(`ws://${location.host}/api/ws`);
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'show-register' }));
});

// 3. Route messages.
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.channel === 'show-presence') setIsActive(msg.data.isActive);
  else if (msg.channel === 'gamemaster-command') handleCommand(msg.data);
  // ...
});

// 4. Publish answer-card state when the view changes.
function emitAnswer(answer: GamemasterAnswerData | null) {
  if (!isActive) return;
  ws.send(JSON.stringify({ channel: 'gamemaster-answer', data: answer }));
}

// 5. Tell the server you're playing a video (to throttle background work).
fetch('/api/backend/stream-notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ active: true }),
});
```

## What NOT to do from a replacement frontend

- **Don't call any `/api/backend/*` endpoint except `stream-notify`.** Those are the admin contract.
- **Don't write to `localStorage` keys scoped to admin or gamemaster.** Each PWA has its own.
- **Don't assume authentication.** There is none. Replacement implementations MAY add it but doing so breaks the current admin + gamemaster PWAs.
- **Don't cache `/api/game/:index` responses across game transitions.** The server re-reads `config.json` per request so edits in the admin are visible immediately; caching defeats this.
