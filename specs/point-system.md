# Spec: Point System

## Goal
Each game awards a fixed point value to the winning team(s); points accumulate across all games and determine the winner shown on the summary screen.

## Acceptance criteria
- [x] Each game is worth `currentIndex + 1` points (game 0 = 1pt, game 1 = 2pt, …)
- [x] After a game completes, the host sees `AwardPoints` UI to select which team(s) won
- [x] The host can award points to team 1, team 2, or both (draw)
- [x] Points are added to the team's running total via `AWARD_POINTS` action
- [x] Points can never go below 0 (enforced in reducer)
- [x] Points are persisted to `localStorage` under keys `team1Points` and `team2Points`
- [x] On reload, points are restored from `localStorage`
- [x] If `pointSystemEnabled` is `false`, the show has **no teams**: `HomeScreen` shows neither the team overview nor the name-assignment textarea — just the "Game Show" title and a "Zum Starten klicken" prompt (`#startPrompt`). The host still advances to `/rules` via a click on empty space, an arrow/space keypress, or the gamemaster forward control (the GM controls collapse to a single nav-forward). See [team-management.md](team-management.md).
- [x] If `pointSystemEnabled` is `false`, jokers are **auto-disabled**: `GET /api/settings` forces `enabledJokers: []` regardless of the active gameshow's configured set (jokers are a per-team mechanic). This cascades to the `Header` (no team columns), the `GlobalRulesScreen` (no joker rules), and every game's joker UI. See [jokers.md](jokers.md).
- [x] If `pointSystemEnabled` is `false`, the `AwardPoints` step is skipped entirely after each game
- [x] If `pointSystemEnabled` is `false`, **every** game type must be fully playable as a pure play-through — no game may require a bet, wager, or scoring action to advance, and `onAwardPoints` is never called. The four inline-scored games hide their point UI when off:
  - **BetQuiz**: no team-select / bet input — the category screen just reveals the question; the answer screen has no Richtig/Falsch, nav-forward moves to the next question.
  - **Quizjagd**: difficulty selection still picks the question but the point values are dropped from the labels ("Leicht/Mittel/Schwer"); after the answer, nav-forward advances the turn without judging.
  - **FinalQuiz**: no bet inputs — nav-forward reveals the answer; no per-team Richtig/Falsch, a plain "Weiter"/"Nächste Frage" advances.
  - **WerKenntMehr**: the count/team scoring panel is hidden (all modes); the standard-mode final winner-selection reward screen is skipped and the game completes directly.
  In all four, the gamemaster forward control stays visible so the GM can advance.
- [x] Host can reset both teams to 0 from `AdminScreen` (single confirmation)
- [x] `SummaryScreen` declares the winner based on final point totals; shows confetti if and only if point system is enabled AND there is a clear winner (no draw)

## State / data changes
- `AppState.teams.team1Points: number` (initial: `localStorage.team1Points ?? 0`)
- `AppState.teams.team2Points: number` (initial: `localStorage.team2Points ?? 0`)
- `AWARD_POINTS` action: `{ team: 'team1' | 'team2' | 'both'; points: number }`
- `RESET_POINTS` action: sets both to 0, clears localStorage entries
- Config flag: `pointSystemEnabled: boolean` in `config.json`
- localStorage keys: `team1Points`, `team2Points`

## UI behaviour
- `AwardPoints` component: shown inside `BaseGameWrapper` after game phase completes (if point system enabled)
- Displays current game's point value; three buttons: Team 1 wins, Team 2 wins, Draw
- `Header`: shows running point totals for both teams at all times
- `SummaryScreen`: announces winner with confetti animation (5 seconds); or "Unentschieden" on a draw
- `AdminScreen`: direct numeric input for each team's points + reset button

## Out of scope
- Per-question point awards (except for `quizjagd` and `final-quiz` which handle points inline — see their specs)
- Negative total points
- Point history / undo
