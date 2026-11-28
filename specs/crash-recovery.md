# Spec: Crash recovery

## Goal

When the Node server dies during a live show, it comes back by itself within about a second and records why it died. The show and gamemaster screens show that the server is unreachable, the projector keeps the main-show slot after the restart, and a reload of the show tab lands on the same game, phase and question in the same shuffled order.

## Acceptance criteria

### Supervisor and crash log
- [x] `npm start` runs `scripts/supervise.cjs`, which starts `node dist/server/server/index.js` with `UV_THREADPOOL_SIZE=32`. The old command is `npm run start:unsupervised`.
- [x] When the server process exits for any reason other than the supervisor itself receiving SIGINT/SIGTERM, the supervisor starts it again. The first restart is immediate, then the delay doubles from 1 s up to 10 s. The delay resets after 60 s of uptime. The supervisor never gives up.
- [x] SIGINT/SIGTERM to the supervisor is forwarded to the server; the supervisor exits after the server has exited and does not restart it.
- [x] Server stdout/stderr go to the console and to `logs/server-YYYY-MM-DD.log`.
- [x] Each unplanned exit appends an entry to `logs/crash.log` (time, exit code or signal, last ~80 stderr lines) and writes `logs/last-crash.json`.
- [x] Hang watchdog: once the server answers `GET /api/health`, the supervisor polls it every 5 s. If it gets no answer for 30 s, it logs "unresponsive", sends SIGKILL and restarts. `SUPERVISE_WATCHDOG=0` disables it.
- [x] `uncaughtException` in the server writes the stack to `logs/crash.log` synchronously, then exits with code 1.
- [x] `unhandledRejection` in the server is logged and the server keeps running.
- [x] A listen error (e.g. `EADDRINUSE`) is logged with a clear message and the server exits with code 1 instead of starting its background work on a server that isn't listening.
- [x] `GET /api/health` returns `{ ok: true, uptimeSeconds, startedAt }` without touching the file system or the NAS.
- [x] The admin System tab shows "Letzter Absturz: <Zeit> – <Grund>" when `logs/last-crash.json` exists (read once at boot, carried as `lastCrash` in the system-status payload).

### Known crash sources
- [x] Every `spawn` of yt-dlp and whisper has an `'error'` listener; a failed spawn becomes a failed job instead of killing the process.
- [x] Every file streamed into an HTTP response goes through `sendFileStream(res, path)`, which answers 404 if the file is gone before headers were sent and otherwise destroys the response. A cache file deleted between `stat` and `open` no longer kills the server.
- [x] `wss` has an `'error'` listener.
- [x] SIGTERM/SIGINT also close the HTTP server, so the port is free quickly for a restart.

### Main show screen after a restart
- [x] The server writes `activeShowId` to `.show-presence.json` (atomic tmp + rename) whenever it changes and restores it at boot.
- [x] For 15 s after boot, when an owner id was restored, a show tab with a different id does not become the active show, even if it is the only show tab connected.
- [x] When the 15 s window ends and the owner has not reconnected, the normal decision runs again over the show tabs that are connected, so a lone spare tab still becomes active.

### Connection indicators
- [x] The show screen displays a small dot in a corner after the WebSocket has been disconnected for 3 s; it disappears on reconnect. It carries `aria-label` and tooltip "Server getrennt".
- [x] The gamemaster screen displays the banner "Server getrennt – verbinde neu…" after 1.5 s disconnected; it disappears on reconnect.
- [x] A gamemaster command that could not be sent (socket not open) flashes "Befehl nicht gesendet" in the banner.
- [x] Taps on the banner do not advance the show (`data-gm-no-nav`).
- [x] Both components have examples in `ThemeShowcase`.
- [x] Before the chunk-load recovery reloads the page, it waits until `GET /api/health` answers, so a failed chunk during an outage does not reload onto the browser's error page.

### Resume after reload
- [x] The playthrough store (shuffle seed, play order, high-water mark, question cursor, phase per game) and the show's current position `{ gameIndex, gameId }` persist in the tab's `sessionStorage` under `show:playthrough`.
- [x] Reloading the show tab on `/game?index=N` reopens game N in the same phase (title, rules, game, award) and, in the game phase, on the same question, with the same question order for randomised games.
- [x] The resume applies only when the saved position's `gameIndex` and `gameId` match the URL index and the loaded game. A different game opens on its title screen as before.
- [x] The resume applies only to the first game opened after the reload. Navigating to another game and back uses the normal back-review behaviour.
- [x] Corrupt or missing `sessionStorage` falls back to the current behaviour without errors.

## State / data changes

- New HTTP endpoint `GET /api/health` → `{ ok: true, uptimeSeconds: number, startedAt: string }`.
- `SystemStatusResponse` gains `lastCrash: { at: string; reason: string } | null` (HTTP `GET /api/backend/system-status` and the `system-status` WS channel).
- New server sidecar `.show-presence.json` → `{ activeShowId: string }` (gitignored).
- New server log folder `logs/` (gitignored): `crash.log`, `last-crash.json`, `server-YYYY-MM-DD.log`.
- `gamePlaythroughStore` entries gain `cursor: number` and `phase`; the store gains `position: { gameIndex, gameId } | null`. Persisted to `sessionStorage` (`show:playthrough`) by the store itself — a utility module, not a component, like `saveQueue`. No `AppState` change: teams and points keep living in localStorage through the reducer.

## UI behaviour

- **Show:** `ConnectionDot` in the bottom-left corner, `clamp()`-sized, muted red, no text. Visible only after 3 s offline so short blips never flash it for the audience.
- **Gamemaster:** `GmConnectionBanner` across the top of the gamemaster screen.
- **Admin:** one line in the system-status card.

### Limits
- Within a question the show resumes at its start: the answer is hidden again, clue and reveal steps reset, the award screen's winner selection is lost.
- Inline-scored games (bet-quiz, quizjagd, final-quiz, wer-kennt-mehr `count`) keep the points already booked in team state. The gamemaster must not score the resumed question twice; `scoreHistory` shows what was booked.
- Quizjagd does not use the live question index and resumes only to its phase, at the start of the game.
- `sessionStorage` does not survive closing the tab without the browser's session restore.
- A reload while the server is down still fails (no offline caching, see [pwa.md](pwa.md)).
- If the server process is stuck in a NAS kernel call, SIGKILL only takes effect once that call returns (see [nas-freeze-resilience.md](nas-freeze-resilience.md)); the watchdog then restarts it.

## Out of scope

- Persisting the server's WebSocket last-value cache across restarts; the active show re-seeds it on reconnect ([cross-device-gamemaster.md](cross-device-gamemaster.md)).
- Offline caching of the PWAs.
- `npm run dev` supervision (`tsx watch` restarts only on file changes).
