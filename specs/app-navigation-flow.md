# Spec: App Navigation Flow

## Goal
Players and the host navigate a fixed linear route from team setup through all game rounds to a final summary screen, with no ability to go backwards.

## Acceptance criteria
- [x] Route `/` (HomeScreen) is the entry point; auto-navigates to `/rules` if `teamRandomizationEnabled` is `false` (once settings are loaded)
- [x] Route `/rules` (GlobalRulesScreen) follows home; auto-navigates to `/game?index=0` if `globalRules` array is empty (once settings are loaded)
- [x] Route `/game?index=N` (GameScreen) loads game N from the ordered `gameOrder` list
- [x] Games advance sequentially: index 0 → 1 → … → totalGames - 1
- [x] After the last game, navigation goes to `/summary` (SummaryScreen)
- [x] `/admin` is accessible at any time as an out-of-band route (not part of the linear flow)
- [x] `currentGame.currentIndex` and `currentGame.totalGames` are set in `AppState` when a game loads
- [x] Back-navigation is not supported; pressing browser back does not break state

## State / data changes
- `AppState.currentGame: { currentIndex: number; totalGames: number } | null`
  - Set via `SET_CURRENT_GAME` action when `GameScreen` loads
  - `null` before any game has loaded
- No localStorage persistence for navigation state (intentional — reloading restarts from home)

## UI behaviour
- `HomeScreen`: textarea for player names; on submit navigates to `/rules` or `/game?index=0`
- `GlobalRulesScreen`: displays rules from config; "Weiter" button navigates to `/game?index=0`
- `GameScreen`: loads game by `?index` query param; on game complete navigates to next index or `/summary`
- `SummaryScreen`: end state; no further navigation
- `AdminScreen`: always accessible via direct URL; does not affect the linear flow

## Out of scope
- Non-linear navigation (jumping to an arbitrary game)
- Resuming a partially completed gameshow after a full page reload
- Multi-device sync (all state is local)
