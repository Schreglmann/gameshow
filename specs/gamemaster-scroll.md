# Spec: Gamemaster Show-Scroll Controls

## Goal
Let the gamemaster scroll the player-facing show to key landmarks (top, answer, bottom) from the `/gamemaster` toolbar, so a host driving the projector on an extended display can reach content that overflows the screen — which they otherwise cannot scroll.

## Acceptance criteria
- [ ] While a game's `.quiz-container` card overflows the show's viewport, the GM toolbar shows a **Scrollen** button row with one button per available jump-point, in order: **⤒ Anfang** (top), **Antwort**, **⤓ Ende** (bottom).
- [ ] **Anfang** and **Ende** appear whenever the card overflows (work for any game). **Antwort** appears only when a `.quiz-answer` element is on screen.
- [ ] The button row is hidden entirely when the show card fits the viewport, or when `phase !== 'game'`.
- [ ] Clicking a button scrolls the **show** (not the GM): **Anfang** to the very top of the page, **Ende** to the very bottom, **Antwort** to the answer area just below the sticky header.
- [ ] Scrolling works regardless of the GM **Lock** toggle (lock only gates navigation advance; scrolling is benign).
- [ ] Available anchors update live as the show grows (answer reveal, images loading) or the phase/question changes.
- [ ] Works for **all** game types via shared landmark detection — no per-game code.
- [ ] Responsive: the buttons are full-width and stacked in a single column (matching the toggle pills), so labels never clip — verified at 375 / 768 / 1024 / 1920px.

## State / data changes
- New type in `src/types/game.ts`: `GamemasterScrollAnchor = 'top' | 'answer' | 'bottom'`.
- New optional field on `GamemasterControlsData`: `scrollAnchors?: GamemasterScrollAnchor[]` — broadcast over the existing `gamemaster-controls` WebSocket channel (server-cached, like the rest of that payload). Non-empty only while the show card overflows.
- New ephemeral commands on the existing `gamemaster-command` channel: `scroll-to:<anchor>` (`scroll-to:top` / `:answer` / `:bottom`). Not cached.
- No new `AppState` fields, no new HTTP endpoints. Cross-client transport only.

## Implementation
- `src/utils/scrollToCardAnchor.ts` — shared geometry: `absoluteOffsetTop()` (transform-safe, reused by `useQuizAutoScroll`), `detectShowScrollAnchors()` (overflow + landmark presence → anchor list), `scrollShowToAnchor()` (smooth `window.scrollTo`).
- `BaseGameWrapper` (show side) — a `useLayoutEffect` (game phase only) recomputes `scrollAnchors` on phase/answerRevealed/question change and via a `ResizeObserver` on the card + header, threading the result into `useGamemasterControlsSync`. Its command listener handles `scroll-to:*` by calling `scrollShowToAnchor` (no game-state change). Mirrors the `deadline-*` transient-UI pattern.
- `GamemasterScreen` — `ScrollButtons` toolbar component reads `useGamemasterControls().scrollAnchors` and emits `scroll-to:<anchor>` via `useSendGamemasterCommand()`.
- CSS `.gm-scroll-group` / `.gm-scroll-label` / `.gm-scroll-grid` / `.gm-scroll-btn` in `gamemaster.css`, matching `.gm-deadline-*`.
- Theme showcase entry in `ThemeShowcase.tsx` (`AdminShowcase`).

## UI behaviour
- Screen affected: `/gamemaster` toolbar (`.gm-toolbar`), below the deadline-timer row.
- The player-facing show scrolls smoothly; the GM mirror view (`GamemasterView`) is unaffected.

## Out of scope
- Scrolling the GM's own mirror view (it renders a condensed mirror, not the show's layout).
- Incremental page-up/page-down scrolling (only named jump-points).
- An `answer` anchor for games that don't use the shared `.quiz-answer` class — those still get Anfang/Ende.
