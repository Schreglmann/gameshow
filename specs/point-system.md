# Spec: Point System

## Goal
Each game awards points to the winning team(s); points accumulate across all games and determine the winner shown on the summary screen.

The show runs with 0–4 teams (`GameshowConfig.teamCount`, default 2) — see
[team-count.md](team-count.md). `pointSystemEnabled` is exactly `teamCount > 0`, so everything below
that describes "the point system off" is the 0-teams case.

## Point modes

*How* a game result becomes points is a per-gameshow choice: `GameshowConfig.pointMode`, set in the
admin Gameshows tab next to `teamCount` and served on `GET /api/settings` as `pointMode`. Omitted
means `positional`, so every pre-existing gameshow keeps the historic behaviour.

| Mode | German label | A game is worth |
|------|--------------|-----------------|
| `positional` (default) | Nach Spielreihenfolge | `currentIndex + 1` — game 0 = 1pt, game 1 = 2pt, … |
| `flat` | Jedes Spiel zählt 1 Punkt | exactly `1`, in every position |
| `per-correct-answer` | 1 Punkt pro richtiger Antwort | one point per correct answer that team gave in this game |

The mode is resolved in **one place** — `BaseGameWrapper`, from `currentIndex` and
`GlobalSettings.pointMode` via `gamePointValue()` ([src/utils/pointMode.ts](../src/utils/pointMode.ts)).
Game components do not pass a point value; they cannot opt out of the mode.

### `per-correct-answer`

- The count comes from the gamemaster's per-question correct-answer tally
  (`tallyTotals`, [src/utils/correctAnswers.ts](../src/utils/correctAnswers.ts)) — the same numbers the
  award cards already state as `"3 richtige Antworten"`. Nothing new is recorded.
- Points are booked **once, at game end**, not per `+` press: corrections, `2×` re-judges and the
  score-history undo all keep working exactly as in the other modes.
- The award screen is **read-only** (see the criteria below): the host confirms the counts rather than
  picking a winner.
- guessing-game's `scoringMode: 'auto'` fills the same tally itself, so it needs no special case —
  each team receives its number of won questions.

**Limitation — games without a tally.** The four inline-scored types (`bet-quiz`, `quizjagd`,
`final-quiz`, `wer-kennt-mehr`) set `hideCorrectTracker` and therefore have no tally to read. They keep
the scoring their type defines in **every** mode: `bet-quiz` / `final-quiz` their ±Einsatz, `quizjagd`
its 3/5/7, `wer-kennt-mehr` its count modes — and `wer-kennt-mehr`'s standard mode keeps the
award-screen value, which still follows `positional`/`flat` but falls back to positional under
`per-correct-answer`. `validate-config.ts` warns when a `per-correct-answer` gameshow contains such a
game, and the Gameshow editor names them inline.

## Acceptance criteria
- [x] A game's point value follows the active gameshow's `pointMode` (table above), resolved once in
      `BaseGameWrapper` — no game component passes a point value of its own
- [x] After a game completes, the host sees the `AwardPoints` screen: one card per ACTIVE team, each a
      toggle, and a single "Punkte vergeben & weiter" button below them. Selecting a team and
      confirming are two separate presses — nothing is booked by a mis-tap on a card
- [x] The host can award points to any subset of the active teams — **two or more selected is the
      draw**; there is no separate "Unentschieden" button
- [x] The confirm button is disabled while no team is selected
- [x] Each card states the points that team would receive (`+3 Punkte` / `0 Punkte`), computed from the
      same value the award books, Aufholjoker ×2 included. The points appear only **once something is
      selected** — before that nobody knows who gets what
- [x] The screen opens **preselected** where the outcome is already known: a verdict the game worked out
      itself (guessing-game's automatic scoring), else whoever leads the gamemaster's correct-answer
      tally for this game (`tallyLeader`), both teams on an equal non-zero count. Nothing tallied and no
      verdict → nothing preselected. The preselection is derived, not seeded into state, so a tally edit
      from another device still moves it — until the host toggles a card, which pins the selection
- [x] A third card line states where the preselection comes from: `2 gewonnene Fragen` from a verdict,
      otherwise `3 richtige Antworten` from the tally. With nothing tallied the line is dropped from both
      cards rather than reading "0 richtige Antworten" twice
- [x] The gamemaster mirrors the same screen: an `award-selection` button-group of team toggles
      (`award-toggle-<teamKey>`, one per active team, `active` mirroring the show) plus an
      `award-confirm` button, disabled while nothing is selected. Either surface can select and either
      can confirm

The five criteria above describe `positional` and `flat`, where the screen asks **who won**. Under
`per-correct-answer` the outcome is already fully determined by the tally, so the same screen renders
read-only:

- [x] In `per-correct-answer` the `AwardPoints` screen is **read-only** (`readOnly`): the cards are not
      toggles — they carry no `aria-pressed`, no press affordance, and a tap does nothing. There is
      nothing to pick, only to confirm
- [x] Every card states its team's points **immediately** (`+4 Punkte` / `0 Punkte`), not gated on a
      selection, alongside the `4 richtige Antworten` line it is computed from. The hint reads
      `Jede richtige Antwort zählt 1 Punkt`
- [x] The confirm button is **never disabled** in this mode — with an empty tally nobody is selected,
      and the host must still be able to advance. Confirming an empty tally books nothing
- [x] Confirming books each active team's `tallyTotals` count as its points (Aufholjoker ×2 included).
      A team on 0 is skipped entirely, so no zero-delta entry reaches `scoreHistory`
- [x] The gamemaster mirrors the read-only screen: the `award-selection` toggle group is replaced by an
      `award-summary` info control stating the same per-team counts, and `award-confirm` stays enabled.
      `award-toggle-<teamKey>` commands are ignored in this mode
- [x] Points are added to the team's running total via `AWARD_POINTS` action
- [x] Points can never go below 0 (enforced in reducer)
- [x] Points are persisted to `localStorage` under the team's key (`team1Points` … `team4Points`)
- [x] On reload, points are restored from `localStorage`
- [x] Points propagate to every connected device on the cached `gamemaster-team-state-v2`
      channel, version-guarded so no client can publish a total older than one already
      in circulation. Points are **never stored server-side** — the server only relays
      and caches the last snapshot. See [cross-device-gamemaster.md](cross-device-gamemaster.md).
- [x] If `pointSystemEnabled` is `false`, the show has **no teams**: `HomeScreen` shows neither the team overview nor the name-assignment textarea — just the "Game Show" title and a "Zum Starten klicken" prompt (`#startPrompt`). The host still advances to `/rules` via a click on empty space, an arrow/space keypress, or the gamemaster forward control (the GM controls collapse to a single nav-forward). See [team-management.md](team-management.md).
- [x] If `pointSystemEnabled` is `false`, jokers are **auto-disabled**: `GET /api/settings` forces `enabledJokers: []` regardless of the active gameshow's configured set (jokers are a per-team mechanic). This cascades to the `Header` (no team columns), the `GlobalRulesScreen` (no joker rules), and every game's joker UI. See [jokers.md](jokers.md).
- [x] The `globalRules` screen's scoring sentence is never authored/stored as part of `globalRules` itself: `config.json`'s `globalRules` holds only the pointMode-agnostic framing lines (see [rules-standard.md](rules-standard.md) "Relationship to `globalRules`"), and `GET /api/settings` always appends `pointModeRule(pointMode, config.pointModeRules)` — computed from the *active* gameshow's `pointMode` — as the last line, so switching a gameshow's mode is immediately reflected. Nothing is appended when `pointSystemEnabled` is `false`.
- [x] The wording of each mode's scoring sentence is operator-editable: `AppConfig.pointModeRules?: Partial<Record<PointMode, string>>`, one entry per mode, edited in the admin ConfigTab ("Punkte-Regel-Texte", next to `globalRules`/`jokerRules`) — same pattern as `jokerRules`. Each field is prefilled with the built-in default (`POINT_MODE_RULE_DEFAULTS`, [src/utils/pointMode.ts](../src/utils/pointMode.ts)) so the operator edits existing text rather than starting blank; a blank/whitespace-only entry falls back to that default.
- [x] If `pointSystemEnabled` is `false`, the `AwardPoints` step is skipped entirely after each game
- [x] If `pointSystemEnabled` is `false`, **every** game type must be fully playable as a pure play-through — no game may require a bet, wager, or scoring action to advance, and `onAwardPoints` is never called. The four inline-scored games hide their point UI when off:
  - **BetQuiz**: no team-select / bet input — the category screen just reveals the question; the answer screen has no Richtig/Falsch, nav-forward moves to the next question.
  - **Quizjagd**: difficulty selection still picks the question but the point values are dropped from the labels ("Leicht/Mittel/Schwer"); after the answer, nav-forward advances the turn without judging.
  - **FinalQuiz**: no bet inputs — nav-forward reveals the answer; no per-team Richtig/Falsch, a plain "Weiter"/"Nächste Frage" advances.
  - **WerKenntMehr**: the count/team scoring panel is hidden (all modes); the standard-mode final winner-selection reward screen is skipped and the game completes directly.
  In all four, the gamemaster forward control stays visible so the GM can advance.
- [x] Host can reset every team to 0 from `AdminScreen` (single confirmation)
- [x] `SummaryScreen` declares the winner based on final point totals; shows confetti if and only if point system is enabled AND there is a clear winner (no draw)

## State / data changes
- `AppState.teams.team1Points: number` (initial: `localStorage.team1Points ?? 0`)
- `AppState.teams.team2Points: number` (initial: `localStorage.team2Points ?? 0`)
- `AWARD_POINTS` action: `{ team: TeamKey; points: number }` — a draw dispatches once per winning team.
  The reducer stamps the log entry's `gameIndex` / `questionNumber` from `AppState.currentGame` /
  `AppState.currentQuestion`, so the action payload stays this small
- `RESET_POINTS` action: sets both to 0, clears localStorage entries
- `GlobalSettings.pointMode: PointMode` — required client-side, normalized from the optional
  `SettingsResponse.pointMode` by `normalizePointMode()`. A setting, not runtime state: no action, no
  localStorage, no WS channel
- Config: `GameshowConfig.pointMode?: 'positional' | 'flat' | 'per-correct-answer'` per gameshow
  (absent = `positional`); `validate-config.ts` rejects any other value and warns when a
  `per-correct-answer` gameshow contains a game without a correct-answer tally
- Config: `pointSystemEnabled: boolean` in `config.json` (global master switch, forces 0 teams) and
  `GameshowConfig.teamCount?: 0|1|2|3|4` per gameshow — see [team-count.md](team-count.md)
- localStorage keys: `team1Points` … `team4Points`

## UI behaviour
- `AwardPoints` component: shown inside `BaseGameWrapper` after game phase completes (if point system enabled)
- Two selectable team cards (`.award-team-card`, gold accent + `aria-pressed` when selected) above one
  `.award-confirm` button; the hint above them reads `Welches Team hat gewonnen?`, `<Team> hat gewonnen`
  or `Unentschieden — beide Teams erhalten Punkte` as the selection changes
- Rendered `inline` (without its own `#awardPointsContainer` surface) by wer-kennt-mehr's standard-mode
  summary, which embeds it in the game's own card — see [games/wer-kennt-mehr.md](games/wer-kennt-mehr.md)
- `Header`: shows running point totals for both teams at all times
- `SummaryScreen`: announces winner with confetti animation (5 seconds); or "Unentschieden" on a draw
- `AdminScreen`: direct numeric input for each team's points + reset button

## Out of scope
- Negative total points

Two former out-of-scope items have since shipped:
- **Point history / undo** — every delta is logged to `TeamState.scoreHistory` and undoable per entry;
  see [gamemaster-cockpit.md](gamemaster-cockpit.md) Piece 1.
- **Per-question point awards** — `bet-quiz`, `quizjagd`, `final-quiz` and `wer-kennt-mehr` award inline
  per question (see their specs), and each delta is attributed to its question for the gamemaster
  breakdown; see [gamemaster-question-scores.md](gamemaster-question-scores.md).
