# Spec: Header

## Goal
A persistent top bar displays both teams' current point totals and the current game progress throughout the gameshow, giving the host and players a constant overview of the score.

## Acceptance criteria
- [x] Header renders three columns: left = Team 1 points, centre = game counter, right = Team 2 points
- [x] Team point columns are rendered only when `AppState.settings.pointSystemEnabled` is `true`; when `false`, both columns are absent entirely
- [x] Centre column shows "Spiel N von M" when `showGameNumber` prop is `true` (default) AND `AppState.currentGame` is non-null
- [x] When `showGameNumber` is `false` or `currentGame` is `null`, the centre column renders an empty `<div>` to preserve three-column layout
- [x] `MusicControls` is rendered in the same header bar but is owned by `App.tsx`, not by this component

## State / data changes
- Reads from `AppState.settings.pointSystemEnabled` and `AppState.currentGame`
- Reads `AppState.teams.team1Points` / `team2Points` for point display
- No writes to state

## UI behaviour
- Component: `src/components/layout/Header.tsx`
- `showGameNumber` prop defaults to `true`; set to `false` on screens where no active game is loaded (e.g. `HomeScreen`, `GlobalRulesScreen`)
- Point totals update reactively as `AppState` changes

## Out of scope
- Editing team names or points from the header (that is `AdminScreen`)
- Per-player score breakdown
- Animated score transitions
