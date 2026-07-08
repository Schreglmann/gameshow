# Spec: App Navigation Flow

## Goal
Players and the host navigate a linear route from team setup through all game rounds to a final summary screen, advancing sequentially and able to step back one step at a time (through games and the pre-game screens).

## Acceptance criteria
- [x] Route `/` (HomeScreen) is the entry point; it always renders and is **never** auto-skipped. With `teamRandomizationEnabled` on it shows the name-pool textarea (→ shuffle); with it off it shows the manual two-team editor (add/remove players by hand — see [team-management.md](team-management.md)). Either way the host advances to `/rules` manually (click empty space, arrow/space key, or gamemaster forward control)
- [x] Route `/rules` (GlobalRulesScreen) follows home; auto-navigates to `/game?index=0` if `globalRules` array is empty (once settings are loaded)
- [x] Route `/game?index=N` (GameScreen) loads game N from the ordered `gameOrder` list
- [x] Games advance sequentially: index 0 → 1 → … → totalGames - 1
- [x] After the last game, navigation goes to `/summary` (SummaryScreen); from the summary, back (ArrowLeft / GM "Zurück") returns to the last game opened at its end
- [x] `/admin` is accessible at any time as an out-of-band route (not part of the linear flow)
- [x] `currentGame.currentIndex` and `currentGame.totalGames` are set in `AppState` when a game loads
- [x] Sequential back-navigation is supported: pressing back (ArrowLeft key / gamemaster "Zurück") on a game's landing (title) screen navigates one step back through the flow. Reached only after a game's in-game phases are exhausted — the full back cascade within a game is `game → rules → landing → (previous step)`. From a later game the previous step is the **previous game** (opened at its title screen); from the **first** game it is the **global rules** screen (`/rules`), or the **start page** (`/`) directly when there are no global rules (the rules screen auto-forwards on empty). From the global rules screen, back goes to the start page (`/`); the start page is the beginning and has no back. Going back to a previous game replays it from its start, which can re-award points; use the gamemaster undo / `scoreHistory` (see [point-system.md](point-system.md)) to reconcile
- [x] The gamemaster back control ("Zurück") is shown on every screen where back is possible (all games, the global rules screen) and hidden only on the start page

## State / data changes
- `AppState.currentGame: { currentIndex: number; totalGames: number } | null`
  - Set via `SET_CURRENT_GAME` action when `GameScreen` loads
  - `null` before any game has loaded
- No localStorage persistence for navigation state (intentional — reloading restarts from home)

## UI behaviour
- `HomeScreen`: textarea for player names; on submit navigates to `/rules` or `/game?index=0`. Start of the flow — no back
- `GlobalRulesScreen`: displays rules from config; forward (ArrowRight/Down/Space/click/GM) navigates to `/game?index=0`; back (ArrowLeft / GM "Zurück") navigates to `/` (start page)
- `GameScreen`: loads game by `?index` query param; on game complete navigates to next index or `/summary`; back on the landing screen navigates to `?index=N-1` (previous game) when `N > 0`, else to `/rules` (or `/` when there are no global rules). `handleNextGame` / `handlePrevGame` own the forward/back navigation; `BaseGameWrapper` invokes `onPrevGame` from the landing-phase back branch (for every game, including the first)
- `SummaryScreen`: end state; forward is disabled, but back (ArrowLeft / GM "Zurück") returns to the last game (`?index=totalGames-1`) opened at its end for review (see [game-back-review.md](game-back-review.md))
- `AdminScreen`: always accessible via direct URL; does not affect the linear flow

## Out of scope
- Non-linear navigation (jumping to an arbitrary game) — only stepping back one game at a time is supported
- Resuming a previous game mid-phase (going back always opens it at its title screen — phase history is not persisted)
- Resuming a partially completed gameshow after a full page reload
- Multi-device sync (all state is local)
