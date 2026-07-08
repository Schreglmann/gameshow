# Spec: Score Reveal (Zähl-Animation + Führungswechsel-Banner)

## Goal
Make the scoreboard dramatic: the team score number counts up (or down on an undo) when points
change, and a "Führungswechsel!" banner appears when the lead flips between the two teams.

> **No audio:** the score reveal is silent. Earlier versions played a per-point tally chime and a
> lead-change sting; both were removed at the user's request. Do not re-add score-reveal sound.

## Acceptance criteria
- [x] When a team's total changes, the displayed number animates from the old value to the new one
      (count up AND count down — a corrected/undo award animates back down).
- [x] When the lead flips (one team overtakes the other), a German "Führungswechsel!" banner appears
      briefly (~2.8s). Establishing a lead from a tie, or settling into a
      tie, is NOT a flip (so no false banner).
- [x] The banner is a **lower-third strip that drops in just below the header** (not over its centre)
      so "Spiel X von Y" stays fully readable. It **names the team that just took the lead**
      ("Führungswechsel! {Team} führt") — no emoji/icon, and **normal case, NOT uppercase** (forcing
      the static words uppercase clashed with the normal-case team name). It uses the theme's primary
      gradient (not a fixed orange/red) so it fits every theme, is `pointer-events: none`, and
      `margin: 0` so it stays horizontally centred regardless of the generic `header div` margin.
- [x] Lead-change detection is computed at render time from the current vs previous totals held in a
      `useRef` — **never stored in AppState / localStorage** (honours the no-derived-state rule).
- [x] Purely presentational: NO new AppState field, Action, reducer case, WS channel, or HTTP route.
      The animation never dispatches and never delays the `AWARD_POINTS` flow or the
      `gamemaster-team-state` broadcast (the GM keeps driving instantly).
- [x] On `prefers-reduced-motion` or on an inactive show tab (`isInactiveShowTab()`), the number
      snaps instantly.

## State / data changes
- None to AppState / config / WS. Hook `src/hooks/useScoreReveal.ts` (animation + flip detection;
  previous totals in refs). `Header.tsx` renders the animated values and owns the banner.

## UI behaviour
- Component: `src/components/layout/Header.tsx` — feeds `team1Points`/`team2Points` through
  `useScoreReveal`, renders the returned animating numbers in the existing score spans, and shows the
  `.fuehrungswechsel-banner` overlay. The banner is absolutely positioned at `top: calc(100% + …)`
  (just below the header) with `left: 50% / translateX(-50%)`, so the header flex row is unaffected
  and "Spiel X von Y" is never covered. The new leader's name is computed at render from the current
  totals (well-defined at a flip) and shown in a `.fuehrungswechsel-leader` span.
- Edge cases: 0–0 → first score is establishment (no flip); a tie breaks the flip chain; the count
  animation is gated off on reduced-motion and inactive show tabs.

## Out of scope
- A scoreboard on the gamemaster PWA (it has none).
- Persisted or derived lead state.
- Per-game or cumulative reveal effects beyond the header.
