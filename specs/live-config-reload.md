# Spec: Live config / games / theme reload (no page refresh)

## Goal

While a show is running, edits to `config.json`, any `games/*.json`, or `theme-settings.json`
reflect in the live frontend with **zero reload or interaction** — regardless of how the edit
was made (admin CMS `PUT`, direct file edit, `git`, or `npm run fixtures`).

## Background

The server already re-reads `config.json` and `games/*.json` fresh on every request
(`loadConfig` / `loadGameConfig` in [server/index.ts](../server/index.ts)). The gap is purely
on the client: settings load once on mount (`GameContext`), the theme loads once
(`ThemeContext`), and a game's data loads once per navigation (`GameScreen`). Nothing tells
the browser the files changed.

The mechanism: a single server-side **file watcher** broadcasts a new `content-changed`
WebSocket event whenever one of the watched files changes; the contexts/screens that hold
snapshotted data re-fetch in response. Because every writer ultimately lands bytes on disk,
one watcher covers all change sources — no need to instrument each write endpoint.

## Acceptance criteria

- [ ] Adding a game to `gameOrder` in `config.json` makes it reachable live (`totalGames` grows; "next game" reaches it) — no reload.
- [ ] Deleting the **currently-playing** game in the config jumps the frontend to the **title screen of the next available game**; if there is no next game, it jumps to the **summary screen** — no reload.
- [ ] Fixing a question's text/answer in a `games/*.json` shows live; if it's the on-screen question, it updates in place without losing position.
- [ ] Appending questions to the currently-playing game makes them reachable live; current position (`qIdx`) and phase are preserved.
- [ ] Changing the theme (admin, or a direct edit of `theme-settings.json`) applies live — on the **show** with a smooth animated transition (only when the resolved theme actually changed), and on the **admin/gamemaster** instantly. The gamemaster on iPad/Safari shows the correct colors without a manual reload.
- [ ] Editing the answers of the currently-playing **ranking** ("Reihenfolge") game live: deleting a revealed answer makes that item disappear and leaves the reveal ready for the next one (it does NOT slide a hidden answer into view); a typo fix on a revealed answer keeps it revealed.
- [ ] Settings changes (point system, global rules, enabled jokers, team randomization) apply live.
- [ ] Fixing the media URL of the **currently-displayed** question in an audio/video game reloads that media instantly.
- [ ] No infinite loops, no flicker on the editing (admin) tab, no disruption to in-progress media playback when unrelated content changes.

## State / data changes

- **New WebSocket channel** `content-changed` (server → client, broadcast). It is an *event*, not state: not in `CLIENT_WRITABLE`, not in server `CACHED_CHANNELS`; on the client it is in `EPHEMERAL_CHANNELS` (no replay to late subscribers — they fetch fresh on mount).
- **New payload type** `ContentChangedPayload` in [src/types/config.ts](../src/types/config.ts):
  ```ts
  export interface ContentChangedPayload {
    config?: boolean; // config.json changed → re-fetch settings + current game
    theme?: boolean;  // theme-settings.json changed → re-fetch theme
    games?: boolean;  // a games/*.json changed → re-fetch current game
  }
  ```
- **New server module** [server/content-watch.ts](../server/content-watch.ts): `startContentWatch(rootDir, gamesDir)` watches the two directories (not the files — survives the endpoints' atomic `tmp → rename` writes), debounces ~200 ms, coalesces flags, and calls `broadcast('content-changed', payload)`. Best-effort node `fs.watch` (try/catch-and-continue, matching the [server/whisper-jobs.ts](../server/whisper-jobs.ts) house pattern). Wired in [server/index.ts](../server/index.ts) after `setupWebSocket`.
- No `AppState` shape change. No localStorage change. No new HTTP route.

## UI behaviour

- **Settings** ([src/context/GameContext.tsx](../src/context/GameContext.tsx)): subscribe to `content-changed`; on `config`, call the existing `loadSettingsAction()` (re-fetch `/api/settings`, dispatch `SET_SETTINGS`). Pure read — safe on active/inactive show, gamemaster, and admin tabs.
- **Theme** ([src/context/ThemeContext.tsx](../src/context/ThemeContext.tsx)): subscribe to `content-changed`; on `theme`, re-fetch `/api/theme`. If the resolved theme visible on this entry differs from current state (the actual-change guard stops the editing tab pulsing from its own echo), apply it via the **`theme-reload-pulse`** repaint animation ([src/styles/themes.css](../src/styles/themes.css)): a `filter: brightness()` dip to near-black and back, with the `data-theme` swap happening under the darkness. The filter animation forces WebKit/Safari (notably the iPad gamemaster) to **re-rasterize** the atmosphere `::before/::after` layers and the custom-property-derived colours — a plain `data-theme` swap, a forced reflow, or a `theme-transitioning` colour cross-fade do NOT force that repaint, so the previous theme's colours lingered until a manual reload. Dimming to dark (rather than the per-game pulse's fade-to-transparent, which on iPad revealed the bright white browser canvas) keeps the flash dark. Applies to both the show and the admin/gamemaster; distinct from `game-theme-switching` so per-game switches are unchanged.
- **Ranking reveal** ([src/components/games/Ranking.tsx](../src/components/games/Ranking.tsx)): the progressive reveal is a positional prefix, so a live edit to the current question's answers reconciles `revealedCount` (`diffSingleElement` + a baseline ref, gated to the same `qIdx`): deleting a *revealed* answer decrements the count (item gone, no hidden answer slides in), deleting an *unrevealed* answer leaves it unchanged, and a same-length text edit only clamps (the corrected text stays revealed).
- **Current game** ([src/components/screens/GameScreen.tsx](../src/components/screens/GameScreen.tsx)): subscribe to `content-changed`; on `config || games`, re-fetch `/api/game/:index` **without blanking** (`gameData` swaps in place). A request-id ref guards against navigation/refresh fetches resolving out of order. The render keys `<GameFactory>` on `gameId` (the gameOrder ref), which determines whether the swap preserves or resets:
  - **Same `gameId`** (an edit to the playing game): no remount — the component's local `qIdx`/phase survive, the `useMemo(..., [config.questions])` recomputes (picking up edits/additions), and `questions[qIdx]` re-reads fresh.
  - **Different `gameId`** (the current game was deleted, so the next game shifted into this index): the key changes → the component remounts → `BaseGameWrapper` resets to its landing/**title screen** showing the next game.
  - **404** (the deleted current game was the last, so the index is now out of range): the live refresh navigates to **`/summary`**. Transient (non-404) live-refresh errors are ignored so a network blip never tears down a running game; the navigation load (`blank=true`) still shows the error screen as before. `fetchGameData` throws `HttpError` (carrying the status) so the 404 case is distinguishable ([src/services/api.ts](../src/services/api.ts)).
- **Instant media reload**: when the **currently-displayed** question's media URL is edited live, the media reloads.
  - [AudioGuess](../src/components/games/AudioGuess.tsx) and [Bandle](../src/components/games/Bandle.tsx) gate media loading on `[qIdx, reloadKey]` only, so they get a dedicated effect that tracks the current question's media URL (Bandle: the `|`-joined track URLs) and bumps the existing `reloadKey` reload primitive when it changes while `qIdx` is unchanged — re-baselining on `qIdx` change so navigation never double-triggers.
  - [VideoGuess](../src/components/games/VideoGuess.tsx) needs **no change**: its load effect already keys on `ev.src` (derived from `q.video` + markers), so a live edit to the current question's video already triggers `video.load()` and segment-cache warmup.

## Out of scope / known limitations

- The watcher is best-effort (`fs.watch`). A rare dropped OS event self-heals on the next change. No polling fallback (low consequence for a config-reload nicety).
- Deleting questions so `qIdx` points past the new end renders blank for the current question until the gamemaster navigates (components already null-guard — no crash).
- Deleting a game that is **not** the current one and sits **before** it in `gameOrder` shifts the current game's index down by one; since the show tracks the game by URL index, a live refresh of that index then resolves to a different `gameId` and remounts to that game's title. Deleting a game **after** the current one is invisible to the current game (its index is unchanged). The same-`gameId`-twice-in-gameOrder case won't remount on deletion (rare).
- Live video-URL edits rely on the normal segment-cache flow; first play of a freshly-pointed video may encode on demand as usual.
- This does not add any new editing UI — it only makes existing edits propagate live.
