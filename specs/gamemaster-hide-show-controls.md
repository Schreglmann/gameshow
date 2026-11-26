# Spec: Gamemaster "Show-Buttons ausblenden"

## Goal
The gamemaster PWA drives the whole show, so the control buttons the show frontend renders for direct
projector interaction (Weiter, Richtig/Falsch, Punkte vergeben, audio play/pause, the music player, team
swap, …) are clutter on the projector. A GM toolbar toggle hides all of them on the show. The setting is
**show-wide** (shared over WebSocket, not per device) and **off by default**.

## Acceptance criteria
- [ ] A toggle button in the GM toggle cluster (`.gm-toggle-group`, left gutter at ≥1280px), placed
  **after** the "Pause-Bildschirm" toggle. Label **"Show-Buttons ausblenden"** while the show's buttons
  are visible, **"Show-Buttons einblenden"** while they are hidden. Class `.gm-show-controls-toggle`,
  highlighted (`--active`) while hidden; `aria-pressed` mirrors the hidden state.
- [ ] The toggle drives a new **cached, client-writable** WS channel `show-controls-hidden`
  (`{ hidden: boolean }`). The GM writes it, the show reads it. Cached on the server, so a show that
  (re)loads while hiding is on comes back with its buttons hidden, and a reloaded GM shows the correct
  toggle state.
- [ ] **Off by default**: with nothing cached (fresh server) the show renders its buttons as before.
- [ ] **Server restart**: the cache is in memory. When the GM's socket reconnects, it re-sends the
  value it knows. A GM that has not learned a value yet (nothing cached, never clicked) sends nothing,
  so opening a GM never resets the setting.
- [ ] While hidden, the show sets the class `show-controls-hidden` on `<html>`, and
  `src/styles/show-controls-hidden.css` applies:
  - **Hidden**: every `<button>`, except those marked `data-show-display` and the inactive-show
    "übernehmen" button (`.inactive-show-claim-btn`); the background-music player (`.music-controls`);
    the audio divider (`.audio-ctrl-divider`); the HomeScreen name-pool form (`.name-form`), its
    instruction line (`#teamAssignmentText`) and the empty "+ Spieler hinzufügen" member slot; the
    "Zum Starten klicken" prompt (`#startPrompt`); the cache-warmup banner buttons
    (`.cache-preflight-banner__btn`); the PWA install button (`.install-button-wrapper--frontend`).
  - **Visible but not clickable** (`pointer-events: none`), because the audience reads them:
    joker icons in the header (`.header-joker`, `data-show-display`), the team cards on the points
    screen (`.award-team-card`, `data-show-display`), Bandle tracks / hint / answer / progress bar,
    the clickable team name on the HomeScreen (`.team-card-name`), and every `input` / `textarea`
    (bets, guesses, counts and team members the GM mirrors onto the show).
  - **Still usable**: the inactive-show "übernehmen" button (the only control without a GM
    equivalent), lightbox clicks on images, and keyboard / click navigation on the show page itself
    (useful as a backup if the GM device fails).
- [ ] New buttons added to the show later are hidden automatically (the rule targets `button`, not a
  list of classes). A button that is a display for the audience opts out with `data-show-display`.
- [ ] Not applied on `/show/theme-showcase`, so the showcase keeps rendering every button.
- [ ] No effect on the GM, the admin or any game JSON / `config.json`. No `AppState` change.
- [ ] Responsive (375 / 768 / 1024 / 1920px): the GM label fits in the 272px gutter on one line.

## State / data changes
- New type `ShowControlsHiddenState { hidden: boolean }` in `src/types/game.ts`.
- New WS channel `show-controls-hidden`: added to `WsChannel` (client + server), `CLIENT_WRITABLE` and
  `CACHED_CHANNELS` in `server/ws.ts`, and to `NOTIFY_ON_DROP` in `src/services/useBackendSocket.ts`
  (a toggle sent while offline raises "Befehl nicht gesendet").
- Contract: channel + send/receive operations + message in `specs/api/asyncapi.yaml`; row in
  `specs/api/inventory.md`; `docs/replace-frontend.md` and `docs/replace-gamemaster.md`.
- No HTTP route, no `localStorage` key, no `AppState` field.

## UI behaviour
- GM: `ShowControlsToggleButton` in `GamemasterScreen.tsx`, same mechanics as `HoldToggleButton`
  (subscribe with `useWsChannel`, send with `sendWs`), styled through the shared toggle selector lists
  in `gamemaster.css`.
- Show: `useShowControlsHidden()` (mounted once in `AppContent`, `src/entries/frontend.tsx`) subscribes
  to the channel and toggles the `<html>` class. All hiding is CSS; no game component branches on it.

## Out of scope
- Hiding non-interactive show content (scores, questions, timers, the connection dot).
- Turning hiding on automatically when a GM connects — the host decides explicitly.
- Disabling keyboard / click navigation on the show.
