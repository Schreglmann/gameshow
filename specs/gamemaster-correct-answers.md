# Spec: Gamemaster Correct-Answers Counters

## Goal
Give the host two manual counters at the bottom of the gamemaster screen to tally correct answers per team while a question is active, showing team members inline so the host can tell which team is which. Each tap is recorded against the question that was live, so the per-question breakdown in [gamemaster-question-scores.md](gamemaster-question-scores.md) can show where a count came from — and where one is missing.

## Acceptance criteria
- [x] Two counters labeled "Team 1" and "Team 2" appear at the bottom of `/gamemaster`
- [x] Each counter has `+` / `−` buttons and shows the current count
- [x] Each counter shows team member names as small subtext
- [x] Count cannot go below 0
- [x] Counts are stored per game index **and per question**; the number shown next to the buttons is the
      game total, derived by summing that game's question buckets. Navigating back to a prior game shows
      its counts; a newly-entered game starts at 0/0. See
      [gamemaster-question-scores.md](gamemaster-question-scores.md) for the breakdown this backs
- [x] `+` / `−` write to the question the show reports as live (`scoringQuestion`), or to the reserved
      `'none'` bucket when nothing is attributable — a tap is never dropped
- [x] `−` is disabled when **the current question's** bucket is 0 (not the game total), and a caption
      under each row names the question the buttons write to plus its count (`Frage 3 · 1`)
- [x] Counts persist in `localStorage` and survive reloads
- [x] Counts sync cross-device via WebSocket channel `gamemaster-question-tally` — see [cross-device-gamemaster.md](cross-device-gamemaster.md)
- [x] `RESET_POINTS` (admin "Punkte zurücksetzen") clears the entire map
- [x] Counters are visible during `phase === 'game'` and `phase === 'points'`
  - Hidden on the landing and rules phases
  - Hidden when `/gamemaster` is opened without a game running
- [x] Counters are hidden for game types whose scoring is already tracked via team points (`bet-quiz`, `quizjagd`, `final-quiz`, `wer-kennt-mehr`) — redundant manual tally serves no purpose there
- [x] Responsive at 320 px / 375 px / 768 px / 1024 px / 1920 px
- [x] The `/game` player-facing screen is unaffected
- [x] No auto-increment from `AWARD_POINTS` — purely manual

## State / data changes
- `AppState.correctAnswersByGame: CorrectAnswersMap` = `Record<gameIndex, Record<questionKey, { team1: number; team2: number }>>` — lifted into `GameContext` from a previous component-local `useState`, then nested per question
- Question keys: the question number as a string (`'0'` = the example question) plus the reserved `'none'` bucket. Per-game totals are derived via `tallyTotals` in [`src/utils/correctAnswers.ts`](../src/utils/correctAnswers.ts), never stored
- Reducer actions: `UPDATE_CORRECT_ANSWER { gameIndex, question, team, delta }`, `SET_CORRECT_ANSWERS { payload }`
- `RESET_POINTS` action clears `correctAnswersByGame` in state and removes the localStorage key
- localStorage key: `correctAnswersByQuestion` — the nested JSON map — written by the reducer for per-client reload resilience
- WS channel: `gamemaster-question-tally` — broadcast on every mutation; active show re-emits on reconnect. Both the key and the channel were renamed when the shape nested, so a stale peer running the old flat normalizer can't silently collapse the map to 0/0 — see [gamemaster-question-scores.md](gamemaster-question-scores.md)
- `GamemasterControlsData` gains optional `phase` and `gameIndex` fields so the gamemaster tab can tell which phase and which game is active
- `GamemasterAnswerData.scoringQuestion?: number` — the question `+`/`−` writes against; omitted when nothing is attributable
- `GamemasterControlsData.hideCorrectTracker?: boolean` — set by `BaseGameWrapper` (via a matching prop) on game types that already track progress through team points (`bet-quiz`, `quizjagd`, `final-quiz`, `wer-kennt-mehr`), so the gamemaster view skips the tracker

## UI behaviour
- Component: [`src/components/common/CorrectAnswersTracker.tsx`](../src/components/common/CorrectAnswersTracker.tsx)
- Rendered at the bottom of [`GamemasterView`](../src/components/common/GamemasterView.tsx) after the controls panel, gated on `(controlsData?.phase === 'game' || 'points') && typeof controlsData.gameIndex === 'number' && !controlsData.hideCorrectTracker`
- Two glassmorphic panels side-by-side; stacked vertically below 480 px
- Each panel: team label (uppercase), team-member names (small muted subtext), row with `−` / game total / `+`, then the per-question caption
- `−` button is disabled when the current question's count is 0
- `+` / `−` buttons reuse `.gm-btn` styling (square touch-friendly variant `.gm-correct-btn`)
- On phones (≤480 px): team panels stack vertically, buttons grow to ≥44 px tap targets

Each team card carries `data-team` and a `<TeamDot>` beside its label, so the host
can attribute a card by colour instead of re-reading four names. See
[team-colors.md](team-colors.md).

## Out of scope
- Auto-increment tied to `AWARD_POINTS`
- Player-facing display of the correct-answers tally

Per-question annotation used to be out of scope; it is now the point of the storage shape, and the
reviewing UI lives in [gamemaster-question-scores.md](gamemaster-question-scores.md).
