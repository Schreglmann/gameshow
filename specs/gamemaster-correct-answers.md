# Spec: Gamemaster Correct-Answers Counters

## Goal
Give the host two manual per-game counters at the bottom of the gamemaster screen to tally correct answers per team while a question is active, showing team members inline so the host can tell which team is which.

## Acceptance criteria
- [x] Two counters labeled "Team 1" and "Team 2" appear at the bottom of `/gamemaster`
- [x] Each counter has `+` / `−` buttons and shows the current count
- [x] Each counter shows team member names as small subtext
- [x] Count cannot go below 0
- [x] Counts are stored per game index — navigating back to a prior game shows its counts; a newly-entered game starts at 0/0
- [x] Counts persist in `localStorage` and survive reloads
- [x] Counts sync cross-device via WebSocket channel `gamemaster-correct-answers` — see [cross-device-gamemaster.md](cross-device-gamemaster.md)
- [x] `RESET_POINTS` (admin "Punkte zurücksetzen") clears the entire map
- [x] Counters are visible only during `phase === 'game'`
  - Hidden on landing, rules, and points phases
  - Hidden when `/gamemaster` is opened without a game running
- [x] Counters are hidden for game types whose scoring is already tracked via team points (`bet-quiz`, `quizjagd`, `final-quiz`) — redundant manual tally serves no purpose there
- [x] Responsive at 320 px / 375 px / 768 px / 1024 px / 1920 px
- [x] The `/game` player-facing screen is unaffected
- [x] No auto-increment from `AWARD_POINTS` — purely manual

## State / data changes
- `AppState.correctAnswersByGame: Record<string, { team1: number; team2: number }>` — lifted into `GameContext` from a previous component-local `useState`
- Reducer actions: `UPDATE_CORRECT_ANSWER { gameIndex, team, delta }`, `SET_CORRECT_ANSWERS { payload, fromRemote? }`
- `RESET_POINTS` action clears `correctAnswersByGame` in state and removes the localStorage key
- localStorage key: `correctAnswersByGame` — JSON `Record<gameIndex, { team1: number, team2: number }>` — written by the reducer for per-client reload resilience
- WS channel: `gamemaster-correct-answers` — broadcast on every mutation; active show re-emits on reconnect
- `GamemasterControlsData` gains optional `phase` and `gameIndex` fields so the gamemaster tab can tell which phase and which game is active
- `GamemasterControlsData.hideCorrectTracker?: boolean` — set by `BaseGameWrapper` (via a matching prop) on game types that already track progress through team points (`bet-quiz`, `quizjagd`, `final-quiz`), so the gamemaster view skips the tracker

## UI behaviour
- Component: [`src/components/common/CorrectAnswersTracker.tsx`](../src/components/common/CorrectAnswersTracker.tsx)
- Rendered at the bottom of [`GamemasterView`](../src/components/common/GamemasterView.tsx) after the controls panel, gated on `controlsData?.phase === 'game' && typeof controlsData.gameIndex === 'number'`
- Two glassmorphic panels side-by-side; stacked vertically below 480 px
- Each panel: team label (uppercase), team-member names (small muted subtext), row with `−` / count / `+`
- `−` button is disabled at 0
- `+` / `−` buttons reuse `.gm-btn` styling (square touch-friendly variant `.gm-correct-btn`)
- On phones (≤480 px): team panels stack vertically, buttons grow to ≥44 px tap targets

## Out of scope
- Auto-increment tied to `AWARD_POINTS`
- Player-facing display of the correct-answers tally
- Per-question annotation (which question was answered correctly)
