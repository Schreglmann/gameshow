# Spec: Gamemaster Remote Controls

## Goal
Duplicate all interactive game controls (award points, navigation, difficulty selection, judgment buttons, inputs) from the player-facing game screen to the gamemaster view, so the host can fully control the game from their own monitor when using extended display.

## Acceptance criteria
- [x] The gamemaster screen (`/gamemaster`) shows a controls panel below the existing answer card
- [x] Navigation controls (Weiter / Zurück) appear during landing, rules, and answer-reveal phases. They are hidden during inline-interaction sub-phases where pressing them would be a no-op (FinalQuiz `betting` and `judging`-before-both-judged, GuessingGame `question`, Quizjagd difficulty pick and judging, BetQuiz `category`; in BetQuiz `answer` only Weiter is hidden because Zurück rewinds to the question). Games declare these phases via the `setNavState({ hideForward, hideBack })` render-prop on `BaseGameWrapper`.
- [x] Award points controls (Team 1 / Team 2 / Unentschieden) appear during the points phase
- [x] Quizjagd: difficulty selection and Richtig/Falsch judgment buttons appear on the gamemaster screen
- [x] FinalQuiz: bet inputs, "Antwort anzeigen" button, and per-team judgment controls appear on the gamemaster screen
- [x] GuessingGame: guess inputs and "Tipp Abgeben" button appear on the gamemaster screen
- [x] AudioGuess: "Ausschnitt wiederholen" and "Ganzer Song" buttons appear on the gamemaster screen
- [x] Bandle: track reveal pills, hint, Auflösung, and audio play/pause/restart appear on the gamemaster screen
- [x] SimpleQuiz: audio play/pause and restart controls appear when question audio is active
- [x] Keyboard shortcuts (ArrowRight/Space → advance, ArrowLeft → back) work on the gamemaster screen
- [x] The existing game screen (`/game`) continues to work exactly as before — all controls remain on the player-facing screen
- [x] Running a gameshow without opening `/gamemaster` has zero impact on game behavior
- [x] Controls update in real-time as game state changes (disabled states, active states, phase transitions)
- [x] Commands from the gamemaster screen are deduplicated by timestamp to prevent double-execution
- [x] Joker controls (per-team toggle for each enabled joker) appear on the gamemaster screen; flipping a toggle emits a `use-joker` command with `{ team, jokerId, used: 'true' | 'false' }` that the frontend's command listener applies via `SET_JOKER_USED` — see [jokers.md](jokers.md)
- [x] Answer / controls / commands sync **cross-device** via WebSocket — see [cross-device-gamemaster.md](cross-device-gamemaster.md)

## State / data changes
- WebSocket channels (replacing the old localStorage transport): `gamemaster-answer`, `gamemaster-controls` (game → gamemaster; cached server-side), `gamemaster-command` (gamemaster → game; ephemeral, not cached)
- Types in `src/types/game.ts`: `GamemasterControl`, `GamemasterButtonDef`, `GamemasterInputDef`, `GamemasterControlsData`, `GamemasterCommand`. The `nav` variant carries optional `hideBack` and `hideForward` flags
- `BaseGameWrapper` exposes a `setNavState({ hideForward?, hideBack? })` render-prop so games can mark sub-phases where the corresponding nav button is a no-op. The wrapper merges this state into the game-phase nav control on every controls broadcast
- `GamemasterControlsData` carries optional `phase` and `gameIndex` so the gamemaster tab can render phase-specific UI (see [gamemaster-correct-answers.md](gamemaster-correct-answers.md))
- No new fields in `AppState` for these channels — cross-client communication is transport-only
- No new HTTP API endpoints; all new message types flow over the existing `/api/ws` WebSocket

## UI behaviour
- Screen affected: `/gamemaster` (GamemasterScreen)
- Layout: answer card on top, controls panel below
- Controls panel uses glassmorphic styling matching the existing answer card
- Buttons are compact (smaller than game-screen buttons)
- Button variants: success (green), danger (red/pink), primary (purple), default (translucent)
- Active buttons show a glow effect
- Input groups have labels, input fields, and a submit button
- Nav controls show "Zurück" and "Weiter" buttons by default. Each can be hidden via the optional `hideBack` / `hideForward` fields on the `nav` control; when both are hidden the row is omitted entirely
- When no controls are available, the controls panel is hidden
- Responsive: works at iPhone SE (320px), iPhone (375px/414px), tablet (768px), laptop (1024px), projector (1920px)
  - Below 480px: input fields stack label above input, buttons grow to fill rows for comfortable touch targets (≥40px min-height), nav row buttons split the width evenly
  - Below 360px: tighter padding and slightly smaller button font so all controls still fit iPhone SE

## Host preferences (toolbar)
- The gamemaster screen renders a **toolbar** (`<div class="gm-toolbar">`) holding three logical groups, each a single flex child so they stay visually distinct: the **toggle cluster** (`<div class="gm-toggle-group">`, the three host-only toggle buttons below), the **countdown group** (`.gm-deadline-group`), and the **scroll group** (`.gm-scroll-group`). The toolbar's inter-group `gap` is deliberately much wider than each group's tight internal gap, so the clusters read as separate even though they sit in one row. The toggle cluster (floated in the left gutter at ≥1280px, inline above the card below that — see the responsive note at the end of this section) contains:
  - **Lock** (`.gm-lock-toggle` / `--locked`) — gates keyboard + click navigation. Persisted in `localStorage` under key `gm-input-locked`.
  - **Answer-image visibility** (`.gm-images-toggle` / `--showing`) — when off, the answer image (`data.answerImage`) is not rendered inside `<GamemasterView>`. **Default off** — answer images stay hidden until the host explicitly reveals them. Persisted in `localStorage` under key `gm-show-answer-images`.
  - **Next-answer preview** (`.gm-next-toggle` / `--hidden`) — when on, the next question's answer (`data.nextAnswer`) is shown in the GM card while the current answer is revealed. **Default on**, and unlike the other toggles its highlight is **inverted**: the resting/default state is unhighlighted (label "Nächste Frage ausblenden"), and the button only lights up (`--hidden`, label "Nächste Frage einblenden") once the host has actively suppressed the preview. Persisted in `localStorage` under key `gm-show-next-answer`. See [gamemaster-next-answer.md](gamemaster-next-answer.md).
- All three toggles are **per-device only** (no WebSocket sync) — two gamemasters on different devices can independently choose lock / image / next-answer state.
- The visibility toggles only affect the gamemaster view; the player-facing `/show` projector is unaffected.
- Below the three toggles, the toolbar renders a **deadline-timer row** (`<div class="gm-deadline-group">`) with four duration buttons (`5s` · `10s` · `30s` · `60s`) plus an optional `Stop` button that only appears while a deadline timer is counting. These are GM-toolbar-local controls (NOT part of `GamemasterControl[]`); they send `deadline-5 / -10 / -30 / -60 / -stop` commands handled in `BaseGameWrapper`. Disabled when `phase !== 'game'`. See [gamemaster-deadline-timer.md](gamemaster-deadline-timer.md).
- Below the deadline row, the toolbar renders a **show-scroll row** (`<div class="gm-scroll-group">`) with one full-width jump-point button per available anchor (**⤒ Anfang** · **Antwort** · **⤓ Ende**). These send `scroll-to:<anchor>` commands handled in `BaseGameWrapper` (a `window.scrollTo` on the show, no game-state change): Anfang/Ende scroll to the very top/bottom of the page, Antwort to the answer area. The row is shown only while the show reports `scrollAnchors` (i.e. its card overflows the viewport) and `phase === 'game'`. See [gamemaster-scroll.md](gamemaster-scroll.md).
- The `GamemasterControlsData` payload broadcast over `gamemaster-controls` carries an optional `deadlineActive` flag so the GM toolbar can render the Stop button only while a timer is running.
- The same payload carries an optional `scrollAnchors: ('top'|'answer'|'bottom')[]` array (non-empty only while the show card overflows its viewport) so the GM toolbar can render the matching show-scroll buttons. See [gamemaster-scroll.md](gamemaster-scroll.md).
- **Toolbar layout is responsive to the available width** (the gamemaster's own viewport — note it also runs embedded in the admin "Antworten" iframe, so this is the iframe width there):
  - **≥1280px**: the toolbar floats as a vertical strip in the LEFT gutter (`position: absolute`), pinned to a **fixed 272px** column width. The width is fixed (not a vw clamp) so the buttons never shrink as the window narrows, and 272px is wide enough that every German label — including the longest, "Nächste Frage ausblenden" — stays on a single line (`white-space: nowrap`). The content card keeps its full `min(95%, 900px)` width but is **centered in the space that remains to the RIGHT of the toolbar**, not on the whole page: `.gamemaster-content` gets a `margin-left` equal to the toolbar's full footprint (its left inset + 272px). Because a centered flex item's margin box is centered, that `margin-left` of M shifts the card's centre by M/2, landing it exactly midway between the toolbar's right edge and the page's right edge (equal left/right gaps). A fixed column width is used rather than the old `max-width: 50% − 478px` cap because the toolbar shrink-to-fits far narrower than that cap, so reserving the cap would over-shift the card.
  - **<1280px** (down to 768px) and on phones (≤640px stacked full-width): the toolbar falls back to an inline top-row layout above the card. Below 1280px the side gutter can't hold the fixed 272px column plus the centered card with comfortable gaps, so the inline layout is the robust choice. In this inline layout the countdown pills lay out as a single **4-up row** and the scroll jump-points as a single **row** (not the gutter's 2×2 / stacked-column arrangements), and the whole row is **bottom-aligned** (`align-items: flex-end`, applied both to the toolbar and to the countdown group internally) so every clickable pill — the label-less toggles and the Pause/Stop timer buttons included — sits on one shared baseline, with the COUNTDOWN / SCROLLEN labels floating above their groups. Pause/Stop share the duration pills' height (`min-height: clamp(36px, 4vw, 44px)`) so they don't read as shorter outliers. The 1280px threshold is derived from the gutter math, not an arbitrary breakpoint.

## Out of scope
- Live two-way sync of input field typing (only submitted values are communicated)
- Removing controls from the game screen (they stay for direct projector interaction)
- Server-side game state management (server only relays + caches last value)
- Syncing host preferences (lock / image visibility) across multiple gamemaster devices
