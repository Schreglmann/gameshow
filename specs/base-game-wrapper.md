# Spec: Base Game Wrapper

## Goal
Every game component shares an identical phase flow (landing → rules → game → award points → next game) managed by a single wrapper, so individual game components only implement the game logic itself.

## Acceptance criteria
- [x] All game components are wrapped in `<BaseGameWrapper>` — no game renders without it
- [x] Phase order: `landing` → `rules` (if game has rules) → `game` → `award-points` (if `pointSystemEnabled`) → navigates to next game
- [x] `rules` phase is skipped when the game config has no `rules` array or an empty one
- [x] `award-points` phase is skipped when `pointSystemEnabled` is `false`
- [x] Any click, Space key, or Arrow key advances the phase from `landing` to `rules` / `game`
- [x] The game component signals completion by calling `onGameComplete()` callback
- [x] After `onGameComplete()`, the wrapper transitions to `award-points` or navigates forward
- [x] After points are awarded (or skipped), the wrapper navigates to `?index=N+1` or `/summary`
- [x] Keyboard navigation is handled by `useKeyboardNavigation` hook — not inline event listeners

## State / data changes
- Phase state is local to `BaseGameWrapper` (not in `GameContext`) — intentional, ephemeral
- `GameContext.currentGame` is updated by `GameScreen` before the wrapper renders
- Navigation is performed via React Router `useNavigate`

## UI behaviour
- `landing` phase: game title card; click or keypress to continue
- `rules` phase: list of rules from `config.rules`; click or keypress to continue
- `game` phase: renders the child game component
- `award-points` phase: renders `<AwardPoints>` component
- Transitions are immediate (no animation)

## Out of scope
- Per-game phase customisation (e.g. skipping landing)
- Animated transitions between phases
- Phase history / back-navigation within a game
