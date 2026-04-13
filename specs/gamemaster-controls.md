# Spec: Gamemaster Remote Controls

## Goal
Duplicate all interactive game controls (award points, navigation, difficulty selection, judgment buttons, inputs) from the player-facing game screen to the gamemaster view, so the host can fully control the game from their own monitor when using extended display.

## Acceptance criteria
- [x] The gamemaster screen (`/gamemaster`) shows a controls panel below the existing answer card
- [x] Navigation controls (Weiter / Zurück) appear during all game phases (landing, rules, game)
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

## State / data changes
- New localStorage keys: `gamemasterControls` (game → gamemaster) and `gamemasterCommand` (gamemaster → game)
- Existing `gamemasterAnswer` key: unchanged
- New types in `src/types/game.ts`: `GamemasterControl`, `GamemasterButtonDef`, `GamemasterInputDef`, `GamemasterControlsData`, `GamemasterCommand`
- No new fields in `AppState` — all communication is via localStorage cross-tab events
- No new API endpoints
- Persisted to localStorage: yes (cross-tab communication only, cleared on tab close)

## UI behaviour
- Screen affected: `/gamemaster` (GamemasterScreen)
- Layout: answer card on top, controls panel below
- Controls panel uses glassmorphic styling matching the existing answer card
- Buttons are compact (smaller than game-screen buttons)
- Button variants: success (green), danger (red/pink), primary (purple), default (translucent)
- Active buttons show a glow effect
- Input groups have labels, input fields, and a submit button
- Nav controls always show "Zurück" and "Weiter" buttons
- When no controls are available, the controls panel is hidden
- Responsive: works at iPhone SE (320px), iPhone (375px/414px), tablet (768px), laptop (1024px), projector (1920px)
  - Below 480px: input fields stack label above input, buttons grow to fill rows for comfortable touch targets (≥40px min-height), nav row buttons split the width evenly
  - Below 360px: tighter padding and slightly smaller button font so all controls still fit iPhone SE

## Out of scope
- Cross-device control (different browser/machine) — only same-browser cross-tab
- Live two-way sync of input field typing (only submitted values are communicated)
- Removing controls from the game screen (they stay for direct projector interaction)
- Server-side game state management
