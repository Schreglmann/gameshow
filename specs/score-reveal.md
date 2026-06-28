# Spec: Score Reveal (Zähl-Animation + Führungswechsel-Sting)

## Goal
Make the scoreboard dramatic: the team score number counts up (or down on an undo) with an ascending
chime when points change, and a "Führungswechsel!" banner + sting fires when the lead flips between
the two teams.

## Acceptance criteria
- [x] When a team's total changes, the displayed number animates from the old value to the new one
      (count up AND count down — a corrected/undo award animates back down).
- [x] When a team **gains** points, a per-point tally plays — one note PER POINT gained, climbing a pentatonic scale (a +3 award rings three ascending notes), via `playCoinTally(delta)`. Draw awards that lift both teams sum the positive deltas. Audible notes are capped so a huge award doesn't run on. **Timbre: a soft bell / celesta** (pure-sine fundamental + quiet octave, smooth decay, no arcade pitch-glide) so it fits the gameshow rather than sounding like a video game.
- [x] When the lead flips (one team overtakes the other), a German "Führungswechsel!" banner appears
      briefly (~2.8s) and a rising sting plays. Establishing a lead from a tie, or settling into a
      tie, is NOT a flip (so no false sting).
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
      snaps instantly with no audio.
- [x] Audio is synthesized via the Web Audio API (no shipped binary asset, offline-safe); best-effort
      (silently no-ops if audio can't start).

## State / data changes
- None to AppState / config / WS. New hook `src/hooks/useScoreReveal.ts` (animation + flip detection;
  previous totals in refs) and `src/utils/revealSound.ts` (Web Audio `playCoinTally` per-point tally +
  `playLeadChangeSting`). `Header.tsx` renders the animated values and owns the banner + audio effects.

## UI behaviour
- Component: `src/components/layout/Header.tsx` — feeds `team1Points`/`team2Points` through
  `useScoreReveal`, renders the returned animating numbers in the existing score spans, and shows the
  `.fuehrungswechsel-banner` overlay. The banner is absolutely positioned at `top: calc(100% + …)`
  (just below the header) with `left: 50% / translateX(-50%)`, so the header flex row is unaffected
  and "Spiel X von Y" is never covered. The new leader's name is computed at render from the current
  totals (well-defined at a flip) and shown in a `.fuehrungswechsel-leader` span.
- Edge cases: 0–0 → first score is establishment (no flip); a tie breaks the flip chain; gated off on
  reduced-motion and inactive show tabs.

## Out of scope
- A scoreboard on the gamemaster PWA (it has none).
- Persisted or derived lead state.
- Per-game or cumulative reveal effects beyond the header.
