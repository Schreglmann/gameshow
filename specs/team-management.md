# Spec: Team Management

## Goal
Two competing teams with named members are set up before the game starts and their state persists across page reloads so the gameshow can survive a browser refresh.

## Acceptance criteria
- [x] If `teamRandomizationEnabled` is `true`, `HomeScreen` shows a textarea where the host enters player names (comma- or newline-separated)
- [x] Names are shuffled then distributed alternately: player 1 → team 1, player 2 → team 2, player 3 → team 1, etc.
- [x] If `teamRandomizationEnabled` is `false`, `HomeScreen` is **not** auto-skipped — instead it shows the two-team overview in **manual mode**, where each team card renders its roster as an inline list of editable text inputs. Every member is editable in place (click a name to change it); **clearing a name's text and blurring removes that player**. Because teams were formed outside the show and are built by hand, each team card additionally renders one trailing blank "ghost" slot (the "+ Spieler hinzufügen" add-line) — typing a name into it appends that player; the same add/remove is also available on the **gamemaster** (a "Spieler hinzufügen" input per team plus a tap-to-remove member list). Teams may start empty. Edits are held in a local draft while typing (so a cleared field doesn't vanish mid-keystroke) and committed to the members-only `SET_TEAMS` action on blur (trim + drop empties); the draft re-syncs from state whenever the roster changes externally and no field is focused. Because everything routes through `SET_TEAMS`, edits sync live across show/GM/admin. The host advances to `/rules` via a click on empty space, an arrow/space keypress, or the gamemaster's forward control (team cards stop click propagation so editing never advances)
- [x] The same inline editable roster is shown in **random mode** after names are assigned (so names can be corrected/removed on the show); there it has **no** "+ Spieler hinzufügen" ghost slot — names come from the pool textarea + shuffle. The add-line is present **only** in manual mode (see above)
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
- [x] In the `Header`, a long custom name first **shrinks its font a little** (the `TeamHeaderName` component steps it down through `[1, 0.92, 0.84, 0.76]` em until it fits, floored so it stays readable) and then truncates with an ellipsis (`.team-header-name`), while the score (": N Punkte", `.team-header-score`) and the joker grid always stay fully visible — the team pill never overflows its column.
- [x] When a name would truncate on the header a **non-blocking** hint is shown at every entry point — the HomeScreen inline edit, the gamemaster rename panel (via an `info` control fed by the input's `emitOnChange`), and the admin SessionTab — the name is still accepted. `isTeamNameLong(name, jokerCount)` measures **against an off-screen replica of the real header** built from the same tag + classes, so all the real (fluid) show CSS applies: it lays out the team pill (score + a joker grid with the right column count via `jokerColumns(count)`, which mirrors the TeamJokers grid 1→1/2→2/3→3/4→2/5→3/6→3) and checks whether the name's content width exceeds its allocated box **at the smallest font the header shrinks to** (`NAME_MIN_FONT_SCALE = 0.76`, matching `TeamHeaderName`). The replica is laid out at the **current display width** (no pinned dimensions) — so it predicts truncation for the screen the name is actually shown/edited on (the primary flow is click-to-edit on the show itself). The replica score uses a 2-digit value (`88`) so a name flagged OK still fits once points reach double digits. There is **no hardcoded character/width budget**. Returns false (no warning) when measurement isn't possible: SSR / no layout (jsdom), or before the theme web font has loaded (`document.fonts.status !== 'loaded'`) — fallback-font metrics would misjudge widths; a later re-render re-measures once the font is ready. Callers pass the enabled-joker count; the hint copy appends "(mit N Joker[n] weniger Platz)" when any are enabled. Callers pass the enabled-joker count to `isTeamNameLong(name, jokerCount)` / `teamNameSoftLimit(jokerCount)`; the hint copy appends "(mit N Joker[n] weniger Platz)" when any are enabled. See [src/utils/teamNames.ts](../src/utils/teamNames.ts).

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
