# Spec: Base Game Wrapper

## Goal
Every game component shares an identical phase flow (landing → rules → game → award points → next game) managed by a single wrapper, so individual game components only implement the game logic itself.

## Acceptance criteria
- [x] All game components are wrapped in `<BaseGameWrapper>` — no game renders without it
- [x] Phase order: `landing` → `rules` (if game has rules) → `game` → `award-points` (if `pointSystemEnabled`) → navigates to next game
- [x] `rules` phase is skipped when `rules.length === 0` — landing transitions directly to game
- [x] `award-points` phase is skipped when `pointSystemEnabled` is `false`
- [x] Any click, Space key, or ArrowRight advances the phase from `landing` to `rules` / `game`
- [x] Back (ArrowLeft key / gamemaster "Zurück") walks the phases in reverse: `game → rules → landing`. On the `game` phase the active game's registered `backNavHandler` may consume the press first (step its own sub-state) before the wrapper falls back to `rules` / `landing`. On the `landing` phase, back invokes `onPrevGame` (always — for every game); the parent (`GameScreen`) decides the destination: the previous game, or the global rules / start page on the first game — see [app-navigation-flow.md](app-navigation-flow.md)
- [x] The gamemaster back control is always shown on the `landing` / `rules` phases (back is always possible from within a game)
- [x] The game component signals completion by calling `onGameComplete()` callback
- [x] After `onGameComplete()`, the wrapper transitions to `award-points` or navigates forward
- [x] After points are awarded (or skipped), the wrapper navigates immediately and automatically to `?index=N+1` or `/summary` — there is no intermediate "proceed to next game" screen or button
- [x] Keyboard navigation is handled by `useKeyboardNavigation` hook — not inline event listeners

## State / data changes
- Phase state is local to `BaseGameWrapper` (not in `GameContext`) — intentional, ephemeral
- `GameContext.currentGame` is updated by `GameScreen` before the wrapper renders
- Navigation is performed via React Router `useNavigate`

## UI behaviour
- `landing` phase: game title card; click or keypress to continue
- `rules` phase: list of rules from `config.rules`; click or keypress to continue
- `game` phase: renders the child game component
- Back navigation: reverses the phase flow (`game → rules → landing`); pressing back on `landing` invokes `onPrevGame`, which the parent routes to the previous game (or, on the first game, out to the global rules / start page)
- `award-points` phase: renders `<AwardPoints>` component; selecting a winner triggers immediate navigation to the next game with no additional confirmation step
- Transitions are immediate (no animation)

## Out of scope
- Per-game phase customisation (e.g. skipping landing)
- Animated transitions between phases
- Persisting phase history across game changes (going back to a previous game reopens it at its landing screen, not where it was left)
