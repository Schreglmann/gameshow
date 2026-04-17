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
- [x] Counts sync across tabs via `storage` events
- [x] `RESET_POINTS` (admin "Punkte zurücksetzen") clears the entire map
- [x] Counters are visible only during `phase === 'game'`
  - Hidden on landing, rules, and points phases
  - Hidden when `/gamemaster` is opened without a game running
- [x] Responsive at 320 px / 375 px / 768 px / 1024 px / 1920 px
- [x] The `/game` player-facing screen is unaffected
- [x] No auto-increment from `AWARD_POINTS` — purely manual

## State / data changes
- New localStorage key: `correctAnswersByGame` — JSON `Record<gameIndex, { team1: number, team2: number }>`
- `GamemasterControlsData` gains optional `phase` and `gameIndex` fields so the gamemaster tab can tell which phase and which game is active
- `RESET_POINTS` action additionally clears `correctAnswersByGame`
- No new `AppState` fields

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
- Cross-device sync (same-browser cross-tab only)
- Player-facing display of the correct-answers tally
- Per-question annotation (which question was answered correctly)
