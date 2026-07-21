# Spec: Gamemaster Background-Music Remote Control

## Goal
Let the gamemaster monitor and control the show's background music from the `/gamemaster`
toolbar, so the host can pause the music while talking, skip a track, adjust volume, and see
what is playing — all without touching the projector/show device. The GM player mirrors the
**show's** music (a single audio stream on the show/PA); it is a remote control, **not** a
second independent player on the GM device.

See also [background-music.md](background-music.md) (the show's audio engine) and
[cross-device-gamemaster.md](cross-device-gamemaster.md) (the show↔GM sync architecture this
reuses).

## Acceptance criteria
- [ ] The GM toolbar shows a docked **Musik** player below the Countdown and Scrollen
      controls (bottom of the left strip in the ≥1280px gutter layout; end of the wrapping
      row below that).
- [ ] The player reuses the show's `MusicControls` *component* but is skinned to match the GM
      toolbar buttons above (`.gm-*-toggle`): its container is a **glass box** with the same border
      + radius as those buttons and a fill tuned so it does not read lighter than them — **not**
      the answer box (whose `--card-border` is a golden outline the player must never use). The
      play/skip buttons sit inside as slightly lighter glass buttons. It is **always expanded** —
      no toggle tab, no slide-out, no auto-hide.
- [ ] It shows: the current track name, elapsed / total time as `m:ss / m:ss`, a play/pause
      button, a skip (next-track) button, a volume slider with `%`, and a click-to-seek
      timeline — the same set the show player exposes.
- [ ] The play/pause and skip buttons are touch-sized (min ~44px, matching the toolbar's other
      buttons); the timeline has an enlarged hit area for touch seeking.
- [ ] The play / pause / skip icons are inline **SVG** (not the Unicode glyphs ▶ ⏸ ⏭, which
      render as system colour emoji on iPad/Safari) so they display identically on every device.
- [ ] The player mirrors the **active show's** music state: play/pause status, track name,
      elapsed time, duration, and volume, updated live (~1 Hz while playing).
- [ ] Play/pause, skip, volume, and seek performed on the GM drive the **show's** audio; the
      show's own `MusicControls` reflects the change too.
- [ ] The volume slider responds immediately when dragged on the GM (optimistic), and settles
      to the value the show echoes back.
- [ ] The player is visible in **all** phases (music plays throughout the show), not only
      during `phase === 'game'`.
- [ ] A GM that (re)connects mid-track paints the current music state within one round-trip
      (server-cached `music-state` + re-emit request), matching the answer/controls recovery.
- [ ] Responsive: the card sits below the scroll controls and never clips at 375 / 768 /
      1024 / 1920px.

## State / data changes
- New types in `src/types/game.ts`:
  - `MusicPlayerState = { isPlaying: boolean; currentSong: string; currentTime: number; duration: number; volume: number }`
  - `MusicCommand = { action: 'toggle' | 'skip' | 'volume' | 'seek'; value?: number; timestamp: number }`
    (`volume`: 0–1; `seek`: 0–1 fraction of the track).
- Two new WebSocket channels (cross-client transport only — no `AppState` fields, no HTTP routes):
  - `music-state` — **show → GM**, server-**cached** last-value (like `gamemaster-controls`).
    Carries `MusicPlayerState`. Emitted only by the **active** show tab.
  - `music-command` — **GM → show**, **ephemeral** (not cached / replayed), timestamp-deduped
    (like `gamemaster-command`). Carries `MusicCommand`.
- No persistence of the show's music state (unchanged — see background-music.md). The GM
  reader keeps a device-local `localStorage` cache under `gm:last-music` purely to paint the
  card before the WS connects (same instant-paint pattern as `gm:last-controls`); it is GM UI
  state, not show state.

## Implementation
- `src/hooks/useMusicSync.ts` (mirrors `src/hooks/useGamemasterSync.ts`):
  - `useMusicStateSync(player)` — **show writer**. Emits `music-state` immediately when
    `{isPlaying,currentSong,duration,volume}` change; a 1 s interval re-emits only when the
    serialized full state (incl. `currentTime`) changed since the last send (a paused track
    stops re-emitting); force re-emits on reconnect / became-active / reemit-request. Gated by
    `isInactiveShowTab()`.
  - `useMusicState()` — **GM reader**. Seeds from `gm:last-music`, then follows `music-state`.
  - `useSendMusicCommand()` — returns `(action, value?) => void`, sends `music-command` with
    `Date.now()`.
  - `useMusicCommandListener(player)` — **show side**. Timestamp-deduped, drops when
    `isInactiveShowTab()`, applies: `toggle` → `isPlaying ? pause() : currentSong ? resume() :
    start()`; `skip` → `skipToNext()`; `volume` → `setVolume(v)`; `seek` → `seekTo(v)`.
- `src/entries/frontend.tsx` (`AppContent`) — calls `useMusicStateSync(musicPlayer)` +
  `useMusicCommandListener(musicPlayer)` alongside the existing `useMusicPlayer()`.
- `src/components/layout/MusicControls.tsx` — new optional `docked?: boolean`. When set: always
  expanded, no toggle, no auto-hide listeners, adds a `docked` class. Default `false` keeps the
  show player unchanged.
- `src/components/screens/GamemasterMusicControls.tsx` — reads `useMusicState()` +
  `useSendMusicCommand()`, keeps a small optimistic-volume `useState`, builds a proxy
  `MusicPlayerControls` (control methods send commands; `fadeOut`/`fadeIn` are no-ops) and
  renders `<MusicControls player={proxy} docked />` inside a `.gm-music-group` with a
  **Musik** label.
- `src/components/screens/GamemasterScreen.tsx` — renders `<GamemasterMusicControls />` after
  `<ScrollButtons />` inside `.gm-toolbar`.
- CSS: `.music-controls.docked` in `src/styles/music.css` resets only the fixed-positioning
  structure (static position, no toggle); the full GM skin lives under `.gm-music-group` in
  `src/styles/gamemaster.css`. The container is a **glass box** matching the toggle buttons
  above — same subtle border (`rgba(var(--glass-rgb), 0.25)`) + `--radius-lg` + `blur(8px)`, but a
  slightly lower fill alpha (`0.07` vs the buttons' `0.12`) so the large continuous panel doesn't
  read lighter than the small button chips (simultaneous contrast). The play/skip buttons + slider
  + timeline use the `.gm-*-toggle` / `.gm-scroll-btn` glass tokens with 44px touch targets and
  shrink-safe (`min-width: 0`) flex so the single control row never overflows.
- WS transport: add both channels to the `WsChannel` unions in `server/ws.ts` (+ `CLIENT_WRITABLE`,
  `CACHED_CHANNELS` for `music-state` only, + doc comment) and `src/services/useBackendSocket.ts`
  (+ `music-command` in `EPHEMERAL_CHANNELS`).
- Theme showcase entry in `ThemeShowcase.tsx` (`AdminShowcase`).

## UI behaviour
- Screen affected: `/gamemaster` toolbar (`.gm-toolbar`), below the Scrollen row.
- The show's audio + its own bottom-right `MusicControls` are the source of truth; the GM card
  mirrors and drives them. The GM device itself plays no audio.

## Out of scope
- An independent second music stream playing on the GM device.
- Choosing / uploading tracks from the GM (DAM stays in the admin).
- Per-track seek precision beyond the click-to-seek fraction the show player already supports.

## Known limitation
Browser autoplay policy: a GM `toggle` that *starts* playback only succeeds if the active show
tab has already had a user gesture (normal during a live show — the operator interacts with the
show to advance it).
