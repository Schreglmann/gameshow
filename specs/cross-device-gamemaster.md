# Spec: Cross-Device Gamemaster Sync

## Goal
Let the gameshow run on one device (laptop/projector) and be controlled from a different device (iPad/phone) over the local network, replacing the previous same-browser-only localStorage transport with WebSocket-based sync and enforcing a single authoritative show frontend.

## Acceptance criteria
- [ ] Opening `/gamemaster` on a different device (different browser on the same LAN) shows the live answer card, controls panel, and correct-answers counters in real time, matching the laptop's show tab
- [ ] Commands sent from the remote gamemaster (nav, award points, jokers, game-specific buttons) execute on the laptop show tab
- [ ] Team members / points / jokers mutated on any client propagate to all connected clients
- [ ] Correct-answers counters mutated on any gamemaster propagate to all connected clients
- [ ] A gamemaster that connects mid-game immediately sees the current answer, controls, phase, team state, and correct-answers map (served from the server-side last-value cache)
- [ ] Multiple gamemaster clients can be connected simultaneously and stay in sync
- [ ] Only one `/show` tab broadcasts authoritative state at a time — the active show. Any other `/show` tab shows a full-screen warning overlay with a "Als Haupt-Frontend übernehmen" button that claims the active role (production only; dev builds always treat the tab as active)
- [ ] When the active show tab closes, the server auto-promotes another registered show client if present
- [ ] Inactive `/show` tabs **drop** incoming gamemaster commands — only the active show responds to navigation / award / joker / game-specific commands
- [ ] When an inactive `/show` tab becomes active (via user claim or auto-promotion), it immediately re-emits its own `gamemaster-answer`, `gamemaster-controls`, `gamemaster-team-state`, and `gamemaster-correct-answers` state, so the gamemaster view snaps to the new active's truth
- [ ] Late-subscribing React listeners receive the last cached value for their channel immediately on mount — so if `gamemaster-answer` arrives before `GamemasterView` mounts, the view still sees the current answer
- [ ] When a gamemaster command is sent, the sender does not receive its own echo (server skips origin on re-broadcast)
- [ ] Commands are never replayed on reconnect — they are ephemeral and not cached
- [ ] State channels (`gamemaster-answer`, `gamemaster-controls`, `gamemaster-team-state`, `gamemaster-correct-answers`) are cached server-side; on server restart, the active show re-seeds the cache on WS `onopen`
- [ ] WebSocket reconnection works via the existing exponential-backoff singleton; no new reconnect code
- [ ] Timestamp-dedup on `useGamemasterCommandListener` is preserved as a defensive guard
- [ ] Running the gameshow on a single device with no remote gamemaster works exactly as before — no behavioral regressions
- [ ] The `gamemaster-answer` writer (`useGamemasterSync`) only emits when its payload **content** changes — a caller that re-renders and passes a referentially-new-but-identical object (e.g. `HomeScreen` on every state change) does NOT re-broadcast. This prevents a lingering start-page surface from re-emitting "Startseite" on every unrelated state update (team/correct-answers), which previously clobbered the live answer on the gamemaster card mid-game
- [ ] When the gamemaster card's mirrored state is internally inconsistent — the `gamemaster-answer` shows a non-game screen label (e.g. "Startseite") while `gamemaster-controls` reports a game phase whose expected label differs — the gamemaster view shows a warning banner ("Anzeige möglicherweise veraltet") with a "Jetzt synchronisieren" button
- [ ] The "Jetzt synchronisieren" button sends `gm-request-reemit`; the server forwards a `show-reemit-request` to the active show, which re-broadcasts its current `gamemaster-answer` + `gamemaster-controls`, recovering the card within one round-trip

## State / data changes
- New WS channels (in `server/ws.ts` and `src/services/useBackendSocket.ts` `WsChannel` union):
  - `gamemaster-answer` — game → gamemaster, cached
  - `gamemaster-controls` — game → gamemaster, cached
  - `gamemaster-command` — gamemaster → game, ephemeral (not cached)
  - `gamemaster-team-state` — any client → any client, cached
  - `gamemaster-correct-answers` — any client → any client, cached
  - `show-presence` — server → individual show client, per-client `{ isActive: boolean }`
- New client→server message types on the same WS endpoint: `show-register`, `show-claim`
- Server-side module-level last-value cache: `Map<WsChannel, unknown>`
- `AppState` gains `correctAnswersByGame: Record<string, { team1: number; team2: number }>` (lifted from the component-local `useState` in `CorrectAnswersTracker`)
- New reducer actions: `UPDATE_CORRECT_ANSWER`, `SET_CORRECT_ANSWERS`
- `RESET_POINTS` now clears `correctAnswersByGame` in state (matches the existing localStorage removal)
- Existing localStorage keys (`team1/2`, `team*Points`, `team*JokersUsed`, `correctAnswersByGame`) remain for per-client reload resilience only — no longer the cross-tab transport
- localStorage keys `gamemasterAnswer`, `gamemasterControls`, `gamemasterCommand` are **removed** — replaced by WS channels

## Protocol invariants
- **Cached state channels**: server stores last value; pushes to every new connection via `sendInitialState`. Clients *also* cache the last received value per channel so that listeners which mount AFTER the initial-state burst still see the current state (see `lastByChannel` in `useBackendSocket.ts`).
- **Ephemeral command channel**: never cached, never replayed. Timestamp-dedup on listeners.
- **Origin skip**: on client→server re-broadcast, the server sends to all OTHER clients; never echoes back to origin.
- **Echo-loop prevention on state channels**: clients compare incoming state via ref-equality (`lastRemoteStateRef`) before re-broadcasting in the `useEffect` that watches that slice — same-object reference skips.
- **Show re-seed on reconnect**: only the active show registers an `onWsOpen` callback that re-emits `state.teams` and `state.correctAnswersByGame`. The gamemaster never re-emits state (it's read-only for state; it only emits commands).
- **Inactive show write-gate**: every sendWs call from a show tab goes through `isInactiveShowTab()` — inactive tabs drop writes on every gamemaster-* state channel. Command listeners also gate on the same flag so inactive tabs never *process* commands.
- **Re-emit on active transition**: when a tab transitions inactive → active (claim / auto-promote), registered `onBecameActive` callbacks re-emit `gamemaster-answer`, `gamemaster-controls`, `gamemaster-team-state`, `gamemaster-correct-answers` so the server cache (and every connected GM) snaps from the old active's stale values to the new active's truth.
- **Server-initiated re-emit request**: on every new WebSocket connection, the server sends a `show-reemit-request` message to the active show. The active show runs all registered `onReemitRequest` callbacks, which call the same writers. This guarantees that a freshly-connected client (GM reload, server-just-restarted) sees current state within one round-trip even when the server cache is empty.
- **GM-initiated re-emit request**: the gamemaster may send a `gm-request-reemit` meta message (via `requestShowReemit()`); the server forwards it as a `show-reemit-request` to the active show. Same recovery path as the server-initiated request, but triggered by the operator clicking "Jetzt synchronisieren" on the desync banner. No-op if no active show is registered.
- **Content-guarded answer emits**: `useGamemasterSync` keys its emit effect on `JSON.stringify(data)` (not the object reference), mirroring `useGamemasterControlsSync`'s `serialized` dep. Screens that pass a fresh object literal each render (HomeScreen, GlobalRulesScreen, SummaryScreen) therefore broadcast their answer only on a genuine content change, not on every unrelated state update. The re-emit-on-reconnect / on-became-active / on-reemit-request paths read `latestRef.current`, so they are unaffected.
- **Desync detection (read-only)**: the gamemaster view compares the `gamemaster-answer` `screenLabel` against `PHASE_SCREEN_LABELS[controls.phase]`. A truthy screen label that doesn't match the controls' phase label means the two cached channels have drifted apart (stale answer from a lingering start-page surface, a connect-timing window, etc.) — the view surfaces a warning + resync button rather than silently showing a misleading label.
- **Heartbeat**: the server pings every client every 10s; any client that fails to pong between two ticks is `terminate()`d. Dead phantom connections (network drop, laptop sleep, SIGKILLed tab) are reaped in 10–20s instead of the 60+ TCP retransmission timeout that would otherwise pin `activeShowWs` to an unreachable client.

## UI behaviour
- Show entry ([src/entries/frontend.tsx](../src/entries/frontend.tsx)): when `useShowPresence().isActive === false` (prod only), render a full-screen overlay with:
  - German heading: "Dieses Frontend ist nicht aktiv"
  - Body copy: "Ein anderes Frontend ist aktuell als Haupt-Frontend registriert."
  - Button "Als Haupt-Frontend übernehmen" → calls `claim()`
- Overlay disappears when the tab becomes active.
- `/gamemaster` and `/admin` entries are unaffected.
- Gamemaster view ([src/components/common/GamemasterView.tsx](../src/components/common/GamemasterView.tsx)): when the answer/controls channels are inconsistent (see protocol invariants), render an amber warning banner above the answer card:
  - German heading: "Anzeige möglicherweise veraltet"
  - Body copy: "Die angezeigte Antwort passt nicht zur aktuellen Spielphase. Synchronisiere neu, um die aktuelle Antwort zu laden."
  - Button "Jetzt synchronisieren" → calls `requestShowReemit()`
  - Banner styles live in [src/styles/gamemaster.css](../src/styles/gamemaster.css) (`.gm-desync-banner`); example in the theme showcase.

## Testing
- Unit: WS mock verifies `sendWs` no-ops when closed; `onWsOpen` fires on reconnect; echo-loop prevention in GameContext; reducer updates for `UPDATE_CORRECT_ANSWER`.
- Tests previously dispatching `StorageEvent` for cross-tab sync rewritten to invoke the WS channel handler via the module singleton.
- Manual two-device test: laptop show + iPad gamemaster on LAN — see AGENTS.md §7 verification loop.

## Out of scope
- Authentication / authorization (implicit single-LAN trust)
- Persisting the server-side cache across server restarts
- Conflict resolution beyond last-write-wins
- Any change to the admin `/admin` surface
- Manual-install flow for the gamemaster PWA (already covered by [pwa.md](pwa.md))
