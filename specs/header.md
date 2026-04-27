# Spec: Header

## Goal
A persistent top bar displays both teams' current point totals and the current game progress throughout the gameshow, giving the host and players a constant overview of the score.

## Acceptance criteria
- [x] Header renders three columns: left = Team 1 section, centre = game counter, right = Team 2 section
- [x] Each team section pairs its points label ("Team N: X Punkte", only rendered when `pointSystemEnabled`) with a compact `<TeamJokers team={...} />` row — see [jokers.md](jokers.md). When BOTH `pointSystemEnabled` is `false` AND no jokers are enabled for the active gameshow, the team section collapses to an empty `<div>` to preserve the three-column layout.
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
