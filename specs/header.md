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
- [x] In a stacked side a label is flush against its joker separator (right on the left side,
      left on the right) so the two rows' names and scores share one vertical line. That inner
      flush is scoped to cells that actually HAVE a joker grid (`:has(.header-jokers)`): with no
      jokers enabled — or in the last game, where they are hidden — the label is **centred** in its
      pill like the two-team header's, because a flush label with no separator next to it just sat
      at the pill's inner edge with the whole outer half empty
- [x] Side by side (above 768px) a stack sizes its pills to the **content** and puts its two teams
      on **one line whenever they fit**, with or without jokers: the stack is a centred row-wrap
      flex line with a real `column-gap`, so both pills sit beside each other when the column is
      wide enough and the second drops under the first — still centred — when it is not. The
      browser decides from the actual widths (no breakpoint), so a long custom name or a wide joker
      row wraps exactly when it has to. The counter keeps its usual pill and its `flex-grow: 0.7`
      share; what buys the one-line form is the team type stepping down to `1.4vw` side by side
      (the stacked layout's `1.85vw` overran the column by a few percent on every screen — the
      header's type is in `vw`, so screen size buys no room, only the pills-to-counter ratio does).
      Every pill has the same minimum width (`9.2em` — the widest default label "Team 4: 99 Punkte"
      — plus its own padding), so the two sides always wrap **together** and a one- and a two-digit
      score draw the same pill; the per-side decision must never leave one side on one line and the
      other on two, which glyph-width differences ("Team 3" vs "Team 1", 9 vs 12 points) would
      otherwise cause mid-show. **Who yields first** decides whether the row holds: each stack's
      `flex-basis` is exactly its one-line width (two default pills + gap, in its own em — the
      same on both sides, so the counter stays centred even at 3 teams), and the counter's basis
      is its generous pill (`8.8em`) with `flex-shrink: 1000` (the stacks keep `1` — flexbox
      hands out only the sum of the unfrozen factors' worth of space when that sum is below 1, so
      a tiny stack factor left the header overflowing on narrow windows), so when the row gets
      tight the counter gives way down to its text before a stack has to wrap. Four default-named teams
      without jokers therefore sit on one line from a 1600px viewport up (measured 1600 → 2560)
      with the team type at `1.55vw` (26.8px on a 1728px MacBook, 29.8px at 1920) and the counter
      still a pill (365px around 291px of text at 1728; 445px at 1920; 581px at 2560); at 1440 and
      below the counter has reached its text and both sides wrap alike, with the counter still
      centred and the header never overflowing.
      With jokers a pill is wider by its joker row and stacks.
      Column-wide pills are gone above 768px because with no or few jokers
      they were mostly empty glass with the text pushed inboard; attribution of a joker grid to its
      team comes from the pill framing both, not from one team per row. Below 768px the wrapped
      one-column layout of full-width rows is unchanged
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

- Each team's cell carries `data-team` and a `<TeamDot>` before the name, so the operator's per-team colour marks it with a coloured underline plus a dot. See [team-colors.md](team-colors.md).

## Out of scope
- Editing team names or points from the header (that is `AdminScreen`)
- Per-player score breakdown
- Animated score transitions
