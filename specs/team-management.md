# Spec: Team Management

## Goal
Two competing teams with named members are set up before the game starts and their state persists across page reloads so the gameshow can survive a browser refresh.

## Acceptance criteria
- [x] If `teamRandomizationEnabled` is `true`, `HomeScreen` shows a textarea where the host enters player names (comma or newline separated)
- [x] Names are shuffled then distributed alternately: player 1 → team 1, player 2 → team 2, player 3 → team 1, etc.
- [x] If `teamRandomizationEnabled` is `false`, `HomeScreen` is skipped entirely (teams are pre-assigned or irrelevant)
- [x] Team member lists (`team1`, `team2`) are persisted to `localStorage` under keys `team1` and `team2`
- [x] On reload, team members are restored from `localStorage` before any API call
- [x] Team names and members are displayed in the app header and on the `AdminScreen`
- [x] Admin can edit team members directly on `AdminScreen` without going back to `HomeScreen`

## State / data changes
- `AppState.teams.team1: string[]` — member names for team 1
- `AppState.teams.team2: string[]` — member names for team 2
- `AppState.teams.team1Points: number` — see point-system spec
- `AppState.teams.team2Points: number` — see point-system spec
- Actions: `SET_TEAMS`, `SET_TEAM_STATE`
- localStorage keys: `team1` (JSON array), `team2` (JSON array)
- Config flag: `teamRandomizationEnabled: boolean` in `config.json`

## UI behaviour
- `HomeScreen` (`/`): single textarea, comma- or newline-separated names, submit button
- On submit: names are parsed, shuffled, and split; `SET_TEAMS` is dispatched; navigate to `/rules` or `/game?index=0`
- `Header`: displays team names alongside current point totals
- `AdminScreen`: editable fields for each team's member list

## Out of scope
- More than two teams
- Team names (the teams have fixed display names, only members change)
- Assigning specific players to specific teams manually
