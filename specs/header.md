# Spec: Header

## Goal
A persistent top bar displays every team's current point total and the current game progress
throughout the gameshow, giving the host and players a constant overview of the score.

## Acceptance criteria
- [x] Header renders the active teams split around the centred game counter: `left = order.slice(0, ceil(N/2))`,
      `right = order.slice(ceil(N/2))`. 1 team → 1 left / 0 right; 2 → the historic 1 / counter / 1;
      3 → 2 + 1; 4 → 2 + 2. The shorter side is padded with the same empty spacer `<div>`s the
      no-teams mode uses, so the counter stays dead centre at every count. Above two teams the
      `.team-header-stack` wrappers are themselves the two equal columns, so no padding is needed
      and the counter is dead centre at 3 and 4 teams too. See [team-count.md](team-count.md)
- [x] At **1 team** the header centres the score and the counter as a pair at one shared size and
      drops the padding spacer — there is no second column to balance. It wraps and clips its X axis
      on a phone, where the score plus a joker strip no longer fits one line
- [x] Above two teams each **side becomes a column** (`.team-header-stack`, added by `Header.tsx`):
      team 1 over team 2 on the left, team 3 over team 4 on the right. The header therefore keeps
      the two-team shape — a side, the counter, a side — at every count, the two stacks are the two
      equal flex columns the counter is centred between (so no spacer padding is needed), and
      **exactly one team occupies each row**. That last point is the whole reason for the stack:
      with all four pills on one row, team 2's joker grid and team 3's ended up adjacent in the
      middle with nothing to say which grid belonged to which name
- [x] A stacked side fits two rows in one header's height by stepping down: tighter vertical cell
      padding, one size smaller type, and a joker grid that drops from 3×2 to a **single row**
      (`grid-auto-flow: column`) with icons at `clamp(22px, 1.7vw, 30px)`. The 4-team header comes
      out at essentially the 2-team header's height (151px vs 154px at 1920)
- [x] Everything else is the two-team styling untouched — the same glass pill, the same
      mirror-image cell layout (left: name | jokers, right: jokers | name), the same separator
- [x] Each team section pairs its points label ("Team N: X Punkte", only rendered when `pointSystemEnabled`) with a compact `<TeamJokers team={...} />` row — see [jokers.md](jokers.md). When BOTH `pointSystemEnabled` is `false` AND no jokers are enabled for the active gameshow, the team section collapses to an empty `<div>` to preserve the three-column layout. That empty placeholder is styled as an **invisible flex spacer** (via `header div:empty` in `layout.css`) — it must NOT render the glass-pill background/border the populated cells use, or two empty pills would flank the centred game counter.
- [x] Below 768px a 3-4 team header **wraps** into a single full-width column: the counter on top
      (no pill), then every team pill under it at full width, label left and joker strip right. Two
      side-by-side stacks get too narrow for a name plus a joker row on a phone
- [x] Centre column shows "Spiel N von M" when `showGameNumber` prop is `true` (default) AND `AppState.currentGame` is non-null
- [x] When `showGameNumber` is `false` or `currentGame` is `null`, the centre column renders an empty `<div>` (same invisible-spacer styling) to preserve three-column layout
- [x] `MusicControls` is rendered in the same header bar but is owned by `App.tsx`, not by this component

## State / data changes
- Reads from `AppState.settings.pointSystemEnabled` and `AppState.currentGame`
- Reads each active team's points (via `teamPoints` in [src/utils/teams.ts](../src/utils/teams.ts))
- Reads `AppState.settings.teamCount` to know which teams are in play
- No writes to state

## UI behaviour
- Component: `src/components/layout/Header.tsx`
- `showGameNumber` prop defaults to `true`; set to `false` on screens where no active game is loaded (e.g. `HomeScreen`, `GlobalRulesScreen`)
- Point totals update reactively as `AppState` changes

## Out of scope
- Editing team names or points from the header (that is `AdminScreen`)
- Per-player score breakdown
- Animated score transitions
