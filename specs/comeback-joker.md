# Spec: Comeback-Joker (Aufholjoker)

## Goal
A single-use joker that **only the currently-trailing team** may spend; it doubles that team's
positional points the next time they win an awarded game, then clears — keeping a runaway lead from
killing late-show tension without any house-ruling.

> **Why this deliberately extends the joker system:** the `/add-joker` skill says jokers are
> GM-resolved and forbids effect logic (catalog entry + icon only). The Aufholjoker is the first
> joker with a **real scoring effect**, so only its catalog entry + icon follow that skill; the
> arming + multiplier are a normal spec-driven feature. Do not "simplify" this back to a no-effect
> joker.

## Acceptance criteria
- [x] New catalog entry `comeback` ("Aufholjoker") in `JOKER_CATALOG` with a German description, plus
      a registered stroke icon (`ComebackIcon`) in `JokerIcon.tsx` (the icon-coverage test enforces
      every id has an icon).
- [x] The comeback joker is clickable (armable) **only for the strictly-trailing team** (lower total
      points). On a tie, neither team may use it. The leading team / tie sees it dimmed + disabled —
      in both the frontend `TeamJokers` header and the GM `JokerControls`. The "trailing team" is
      computed at read time from `team1Points`/`team2Points`, never stored.
- [x] An already-used comeback joker can still be toggled off (to disarm) regardless of standings.
- [x] Using it marks the joker used (existing `SET_JOKER_USED` + `use-joker` command) **and** arms a
      transient `TeamState.doubleNextGame = <that team>` via `ARM_DOUBLE_NEXT_GAME`; toggling off
      disarms via `CLEAR_DOUBLE_NEXT_GAME`.
- [x] On the next **awarded** game (the `AwardPoints` reward screen), the armed team's positional
      points are doubled — `pointValue * 2`, multiplying the positional value (`currentIndex + 1`),
      never a hardcoded number — then the flag clears regardless of who won. On a draw, only the armed
      team's points double.
- [x] The `AwardPoints` screen shows a "×2 Aufholjoker" badge on the armed team's button while the
      flag is set.
- [x] `doubleNextGame` rides the cached `gamemaster-team-state` channel (cross-device + reconnect),
      is persisted to localStorage, and is cleared by `RESET_POINTS`, `RESET_JOKERS`, and `CLEAR_ALL`.

## State / data changes
- New `TeamState.doubleNextGame?: 'team1' | 'team2' | null` (`src/types/game.ts`).
- `GameContext.tsx`: actions `ARM_DOUBLE_NEXT_GAME { team }` / `CLEAR_DOUBLE_NEXT_GAME`; localStorage
  key `doubleNextGame` (read in `getInitialState`, written inside the reducer only); included in
  `SET_TEAM_STATE` persist/restore, the inbound WS normalizer, the cold-start `hasData` gate, and all
  reset clears. `AWARD_POINTS`/`applyPointDelta` stays a pure add — the ×2 is applied at the call site.
- Multiplier applied in `BaseGameWrapper.handleComplete` (AwardPoints path). The flag is cleared
  there; for inline-scored games it is cleared in `onGameComplete` (the multiplier does not apply to
  inline scorers — see Out of scope).
- WS contract: `TeamState` schema in `asyncapi.yaml` gains `doubleNextGame`.

## UI behaviour
- Frontend header (`TeamJokers`): comeback icon dimmed/disabled for the leading team and on a tie;
  enabled (and arms on click) for the trailing team.
- GM (`GamemasterView` `JokerControls`): same gating; the GM toggle arms/disarms too.
- `AwardPoints`: "×2 Aufholjoker" badge on the armed team's button.
- Edge cases: tie → neither team may arm (strict inequality); a draw award only doubles the armed
  team; reverting the joker disarms.

## Out of scope
- **Inline-scored game types** (bet-quiz, quizjagd, final-quiz, wer-kennt-mehr count modes) award
  points directly without the `AwardPoints` screen, so the ×2 does **not** apply to them. If the next
  game is inline-scored, the armed flag is cleared on its `onGameComplete` so it doesn't bleed into a
  later game. (Semantics: the multiplier doubles the next **AwardPoints** resolution for the armed
  team. Arm it at a game boundary.)
- Stacking multiple multipliers.
- Tracking exactly which game index is "next" — the flag applies to the next AwardPoints resolution.
