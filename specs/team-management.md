# Spec: Team Management

## Goal
Two competing teams with named members are set up before the game starts and their state persists across page reloads so the gameshow can survive a browser refresh.

## Acceptance criteria
- [x] If `teamRandomizationEnabled` is `true`, `HomeScreen` shows a textarea where the host enters player names (comma- or newline-separated)
- [x] Names are shuffled then distributed alternately: player 1 → team 1, player 2 → team 2, player 3 → team 1, etc.
- [x] If `teamRandomizationEnabled` is `false`, `HomeScreen` is skipped entirely (teams are pre-assigned or irrelevant)
- [x] Team member lists (`team1`, `team2`) are persisted to `localStorage` under keys `team1` and `team2`
- [x] On reload, team members are restored from `localStorage` before any API call
- [x] Team names and members are displayed in the app header and on the `AdminScreen`
- [x] Admin can edit team members directly on `AdminScreen` without going back to `HomeScreen`

### Optional team names
- [x] Each team has an **optional** custom name. When unset (or blank), the app falls back to the positional label "Team 1" / "Team 2" everywhere — so shows that don't use the feature are unchanged.
- [x] The display name is computed at read time via `teamName(teams, 1 | 2)` in [src/utils/teamNames.ts](../src/utils/teamNames.ts) — never stored as derived state. Used everywhere a team is labelled: `Header`, `AwardPoints`, `SummaryScreen` (winner text), `CorrectAnswersTracker`, `GamemasterView` (joker cards), `HomeScreen` (team headings), `SessionTab` placeholders, the shared `BaseGameWrapper` award buttons, and the per-game scoring UIs (`BetQuiz` team/judgment, `Quizjagd` turn label, `FinalQuiz` bets + judging, `GuessingGame` tip labels/results, `WerKenntMehr` winner selection). Both the on-screen labels AND the labels sent to the gamemaster over the controls channel reflect the name.
- [x] Names are set by **click-to-edit**, not upfront text fields. On the `HomeScreen`, after teams are randomized, clicking a team heading turns it into an inline input (Enter/blur commits, Escape cancels); clicking the heading does not advance to the rules. On the **gamemaster**, after assignment the two team names render as buttons — tapping one swaps it for a rename input + "Speichern"/"Abbrechen". The admin `SessionTab` keeps its always-visible name fields (admin context).
- [x] Names live in the synced `TeamState`, so they persist to `localStorage` and propagate across all devices via the cached `gamemaster-team-state` WS channel — no new endpoint.
- [x] A points/teams reset (`RESET_POINTS`) and a full clear (`CLEAR_ALL`) also clear the names back to the default labels.
- [x] In the `Header`, a long custom name truncates with an ellipsis (`.team-header-name`) while the score (": N Punkte", `.team-header-score`) and the joker grid always stay fully visible — the team pill never overflows its column.
- [x] When a name exceeds `TEAM_NAME_SOFT_LIMIT` (12) characters, a **non-blocking** hint is shown at every entry point — the HomeScreen inline edit, the gamemaster rename panel (via an `info` control fed by the input's `emitOnChange`), and the admin SessionTab — the name is still accepted. 12 is the empirically-measured count that always fits the projector (≥1920px) header; smaller screens truncate sooner. See `isTeamNameLong` in [src/utils/teamNames.ts](../src/utils/teamNames.ts).

## State / data changes
- `AppState.teams.team1: string[]` — member names for team 1
- `AppState.teams.team2: string[]` — member names for team 2
- `AppState.teams.team1Name?: string` — optional custom name for team 1
- `AppState.teams.team2Name?: string` — optional custom name for team 2
- `AppState.teams.team1Points: number` — see point-system spec
- `AppState.teams.team2Points: number` — see point-system spec
- Actions: `SET_TEAMS`, `SET_TEAM_STATE`, `SET_TEAM_NAMES`
- localStorage keys: `team1` (JSON array), `team2` (JSON array), `team1Name` (string, omitted when blank), `team2Name` (string, omitted when blank)
- Config flag: `teamRandomizationEnabled: boolean` in `config.json`

## UI behaviour
- `HomeScreen` (`/`): two optional team-name inputs + a textarea (comma- or newline-separated names), submit button
- On submit: names are parsed, shuffled, and split; `SET_TEAM_NAMES` (names) and `SET_TEAMS` are dispatched; navigate to `/rules` or `/game?index=0`
- `Header`: displays each team's name (or fallback) alongside current point totals
- `AdminScreen` (`SessionTab`): editable fields for each team's name + member list

## Out of scope
- More than two teams
- Per-team colors or avatars
- Predefining team names in `config.json` (names live only in the live team state)
- Assigning specific players to specific teams manually
