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
- [x] If `pointSystemEnabled` is `false`, the `AwardPoints` step is skipped entirely after each game
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
