# Spec: Team order & gamemaster mirror

## Goal
Let the operator control which team sits on the **left** of the crowd-facing frontend (for whatever way the teams are physically seated), and always show the two teams **mirrored** on the gamemaster (GM) screen — because the GM faces the crowd, so their screen must spatially match the room.

## Background
`team1`/`team2` are stable **identities** — points, jokers, correct-answer counts and score history stay attached to their team. Historically `team1` rendered on the left and `team2` on the right on every surface, purely from JSX/DOM source order (no data flag, no CSS `order`). This feature adds a single presentation flag that flips the left/right **order** without moving any team data.

## Model
A boolean `orderSwapped` (physical seating — is the frontend's left team `team2`?) drives left→right order per surface:

- **Frontend** (crowd-facing): `orderSwapped ? [team2, team1] : [team1, team2]`
- **Gamemaster** (faces the crowd → always the mirror): `orderSwapped ? [team1, team2] : [team2, team1]`

Both come from one helper, [`src/utils/teamOrder.ts`](../src/utils/teamOrder.ts):

```ts
teamDisplayOrder(swapped: boolean | undefined, mirror = false): [TeamKey, TeamKey]
// leftIsTeam2 = mirror ? !swapped : Boolean(swapped)
```

The GM mirror is **fixed** (not a separate toggle). The swap is operator-controlled.

The whole feature is **opt-in**: `GlobalSettings.teamMirrorEnabled` (from `config.json`, default `false`/unset). Until an operator turns it on in the admin, `teamDisplayOrder(..., enabled=false)` returns the natural `[team1, team2]` everywhere, the "Teams tauschen" control (show button + GM control) is hidden, and there is no GM mirror.

## Acceptance criteria

### State & sync
- [ ] `TeamState.orderSwapped?: boolean` added; defaults to `false` (undefined ⇒ not swapped).
- [ ] New reducer action `SET_TEAM_ORDER { swapped: boolean }` sets it and persists `localStorage['teamOrderSwapped']`.
- [ ] Restored from `localStorage` in `getInitialState`; persisted by `SET_TEAM_STATE`; rides the existing `gamemaster-team-state` WS broadcast so all devices (show/GM/admin) stay in sync — no new channel/endpoint.
- [ ] `RESET_POINTS` **keeps** `orderSwapped` (a score reset doesn't move furniture); `CLEAR_ALL` resets it to `false` and removes the key.

### Frontend order (mirror = false)
- [ ] `Header` shows the two team cells in `teamDisplayOrder(swapped)` order; the mirror-image cell layout (label/joker order, border side, tooltip direction) is **position-based** (left vs right), so a swapped team on the left still gets the left-cell layout. The team's data/jokers follow its identity.
- [ ] `HomeScreen` `#teams` renders both team cards in swapped order.
- [ ] `AwardPoints` orders the two team buttons in swapped order; "Unentschieden" stays last.
- [ ] `BetQuiz` (category host panel team-choice), `FinalQuiz` (bet inputs + judgment groups), `GuessingGame` (guess inputs + result rows) and `WerKenntMehr` (host-panel team-choice + summary buttons) render their two-team columns in swapped order.

### Gamemaster order (mirror = true)
- [ ] `GamemasterView` joker cards and `CorrectAnswersTracker` render the two teams in mirrored order.
- [ ] The GM **control panels** built by `BetQuiz` (`team-selection`), `FinalQuiz` (`betting-submit` inputs + the two judgment button-groups), `GuessingGame` (`guess-submit` inputs), `WerKenntMehr` (`round-winner` + `winner-selection` + `final-winner`) and `BaseGameWrapper` (the end-of-game `award` button-group) list their team entries in mirrored order; non-team entries ("Unentschieden"/draw) stay last.
- [ ] The gamemaster **team-setup controls** in `HomeScreen` mirror too: the "Teamname ändern" buttons (`edit-team1`/`edit-team2`) and, in manual mode, the per-team add-player inputs + tap-to-remove member lists.
- [ ] `Quizjagd` is unchanged (turn-based — one team at a time, no side-by-side layout).

### Opt-in gate (`teamMirrorEnabled`, default `false`)
- [ ] Until enabled, every surface above shows the natural `[team1, team2]` order (no swap, no GM mirror).
- [ ] The "Teams tauschen" button (show) and `swap-teams` GM control are hidden while disabled.
- [ ] Toggleable in the admin **Konfiguration** tab ("Team-Spiegelung & Seitenwechsel (Gamemaster)"), off by default.

### Toggle UI
- [ ] `HomeScreen`: a **"Teams tauschen"** button near `#teams` (only once teams exist) dispatches `SET_TEAM_ORDER { swapped: !orderSwapped }`; clicking it does not advance to the rules.
- [ ] Gamemaster remote: a `swap-teams` button (label "Teams tauschen") in the team-editing control set toggles the same flag.
- [ ] Toggling on any device flips the frontend order AND the GM mirror everywhere, live.

## State / data changes
- `AppState.teams.orderSwapped?: boolean`
- Action: `SET_TEAM_ORDER { swapped: boolean }`
- localStorage key: `teamOrderSwapped` (`"true"`/`"false"`)
- WS: no new channel — carried in the existing `gamemaster-team-state` `TeamState` payload (added the optional field to `specs/api/asyncapi.yaml`)
- Config: `AppConfig.teamMirrorEnabled?: boolean` → `SettingsResponse.teamMirrorEnabled` (`GET /api/settings`, in `specs/api/openapi.yaml`) → `GlobalSettings.teamMirrorEnabled` (opt-in, default `false` via `=== true`)
- Helper `teamDisplayOrder(swapped, mirror, enabled)` in [src/utils/teamOrder.ts](../src/utils/teamOrder.ts) — `enabled=false` forces `[team1, team2]`

## UI behaviour
- New helper `src/utils/teamOrder.ts` (`teamDisplayOrder`, `TeamKey`).
- `Header` refactored so cell layout is keyed to position (`team-header-left`/`team-header-right`, `header-jokers-left`/`header-jokers-right`); `TeamJokers` gains a `side` prop for its styling class (its `team` prop still selects the data). The off-screen name-measurement replica in `teamNames.ts` and the `ThemeShowcase` header examples use the same position classes.
- Toggle labelled "Teams tauschen" on both the show setup screen and the GM remote.

## Out of scope
- A separate toggle to disable the GM mirror (it is always on).
- Reordering surfaces that show only one team at a time (`Quizjagd` turn label, `SummaryScreen` winner, `BetQuiz`/`FinalQuiz` single-team banners).
- Persisting `orderSwapped` in `config.json` (it lives only in live team state, like team names).
- More than two teams.
