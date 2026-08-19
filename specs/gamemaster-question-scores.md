# Spec: Gamemaster Per-Question Scoring Breakdown

## Goal
Give the host a per-question record of what each team scored in the running game — a collapsible
"Wertung pro Frage" panel on the gamemaster screen — so a forgotten award or a double award is visible
while it is still fixable, instead of only showing up as a per-game total that is silently one too low.

Extends Piece 1 of [gamemaster-cockpit.md](gamemaster-cockpit.md) (the scoring audit log) and supersedes
its "Out of scope: Per-game grouping / full session ledger UI" bullet.

## Acceptance criteria

### Attribution — the `+`/`−` tally (normal games)
- [x] The correct-answers tally is stored **per question**, not just per game:
      `correctAnswersByGame[gameIndex][questionKey] = { team1, team2 }`.
- [x] `questionKey` is `String(scoringQuestion)`; `'0'` is the example question ("Beispiel"); the
      reserved key `'none'` collects taps made while no question is attributable — a tap during a live
      show is never silently dropped.
- [x] The per-game total shown next to the `+`/`−` buttons is **derived** by summing the per-question
      buckets (`tallyTotals` in `src/utils/correctAnswers.ts`), never stored.
- [x] `+`/`−` write to the question that is live on the show at that moment.
- [x] `−` is disabled when the **current question's** bucket is 0 (not when the game total is 0) —
      otherwise the reducer's unchanged-state short-circuit would make a tap on a visible non-zero
      total do nothing.
- [x] The tracker shows a caption naming the question the buttons write to and what it already holds
      (`Frage 3 · 1`), so both the attribution and a disabled `−` are legible without expanding the panel.
- [x] Editing the playing game's questions **re-keys the tally in the same beat**. `questionKey` is a
      position, so adding or removing a question would otherwise misattribute every bucket after the
      edit. `BaseGameWrapper` dispatches `REMAP_QUESTION_TALLY { gameIndex, moved }` on an
      `order.revision` bump; a **deleted** question's counts merge into the `'none'` bucket rather than
      onto its neighbour — never dropped, never re-attributed. Historical `ScoreLogEntry` rows are left
      untouched. See [live-question-order.md](live-question-order.md).

### Attribution — real points (inline-scored games)
- [x] `ScoreLogEntry` records `questionNumber?`, so every point delta in bet-quiz / quizjagd /
      final-quiz / wer-kennt-mehr is attributable to the question that produced it.
- [x] The question is sourced from `AppState.currentQuestion` **inside the reducer**, exactly as
      `gameIndex` already is. `onAwardPoints`'s signature is unchanged and no game component is touched.
- [x] Whole-game (positional) awards carry **no** `questionNumber`: they happen in the `points` phase,
      where `currentQuestion` is `null`. They are shown in a separate "Gesamt" row.
- [x] `SCORE_HISTORY_CAP` is 60, and trimming is **current-game-preserving** — entries from other games
      are evicted first, so the panel can never show a truncated current game. (One bet-quiz judgment in
      `transfer` mode writes 2 entries, 4 on a re-judge; a flat cap alone gives no guarantee.)

### The panel
- [x] `QuestionScorePanel` renders on the gamemaster view when
      `(phase === 'game' || phase === 'points')` and `controlsData.gameIndex` is a number.
      Deliberately **not** on `landing`: `gameIndex` there is already the *next* game, so the panel would
      show empty rows for a game that has not been played. Between-games review stays with
      "Letzte Wertungen".
- [x] Collapsible, collapsed by default, header "Wertung pro Frage" with a count pill — the same
      pattern as `.gm-score-history` / `.gm-jokers`.
- [x] One row model, two feeds, selected off the existing `hideCorrectTracker` signal:
      normal games read the per-question tally (counts); inline-scored games aggregate `scoreHistory`
      filtered to the current `gameIndex`, grouped by `questionNumber` (net signed points per team).
      guessing-game's automatic scoring (its default) writes its per-question winners INTO the tally
      feed, so the panel shows real rows during play even though the points are awarded only at the end;
      it also sets `tallyReadOnly` on the controls channel, which drops the rows' `+`/`−` (and the
      `CorrectAnswersTracker` buttons) so a hand-edit can't compete with the show's own scoring, and it
      clears its own bucket (`RESET_GAME_TALLY`) when the host starts the game from its title screen.
      See [games/guessing-game.md](games/guessing-game.md).
- [x] Rows run `1 … max(current question, highest question holding data)`. Taking the max is what keeps
      a corrected row visible after the host navigates **back** — hiding a just-corrected row would be
      this feature's worst failure mode.
- [x] `Beispiel` (key `'0'`), `ohne Frage` (key `'none'`) and `Gesamt` (question-less point entries)
      rows are rendered only when they hold data.
- [x] A team with nothing on a question renders a neutral `—`. Only a row where **neither** team has
      anything gets the muted "keine Wertung" treatment — in every inline-scored game exactly one team
      is awarded per question by construction, so a per-cell warning would fire on every row.
- [x] A cell that aggregates **more than one** `scoreHistory` entry is marked (`2×`). Net-summing alone
      would render a double award or a reversal-under-clamp as "nothing happened" — masking exactly what
      the host opened the panel to find.
- [x] Tally rows are editable via compact per-team `−`/`+` (that is how a forgotten question gets fixed
      where it happened) — except while the playing game scores itself (`tallyReadOnly`), when they are
      not rendered at all. Point rows are read-only — corrections there go through the existing per-entry
      undo in "Letzte Wertungen".
- [x] Every write path is suppressed while `GamemasterView`'s `desynced` flag is true: attribution
      depends on both `gamemaster-answer` (question) and `gamemaster-controls` (gameIndex) being fresh.
- [x] **Not** gated on `hideAnswers` — the panel carries no answer content, consistent with the
      score-history precedent in [gamemaster-hide-answers.md](gamemaster-hide-answers.md).
- [x] Responsive at 375 / 768 / 1024 / 1920 px; German labels throughout.
- [x] Represented in `ThemeShowcase` so every theme is verifiable at `/theme-showcase`.

## State / data changes

- `src/types/game.ts`
  - `ScoreLogEntry.questionNumber?: number` — the question this delta belongs to; omitted for
    whole-game awards and when nothing was attributable.
  - `GamemasterAnswerData.scoringQuestion?: number` — the question a tally/point award made right now
    belongs to; **omitted** when nothing is attributable (example question, non-game phase, summary
    screens). A dedicated field is required: `questionNumber === 0` already means *Beispiel*, and
    `emitCachedGamemasterState` publishes `questionNumber: 0` after a show reload, so overloading it
    would dump taps into the example bucket.
- `src/context/GameContext.tsx`
  - `CorrectAnswersMap` becomes `Record<gameIndex, Record<questionKey, { team1, team2 }>>`
    (`CorrectAnswersByQuestion`).
  - `UPDATE_CORRECT_ANSWER` payload gains `question: string`.
  - `AppState.currentQuestion: number | null` + `SET_CURRENT_QUESTION`. Dispatched by
    `BaseGameWrapper`; cleared by `SET_CURRENT_GAME`. **Not persisted** — the active game
    re-establishes it on mount.
  - `AWARD_POINTS` stamps `questionNumber` from `state.currentQuestion`.
- Persisted to localStorage: the tally under the **new** key `correctAnswersByQuestion`;
  `scoreHistory` as before. `currentQuestion` is not persisted.
- WS: the tally moves to the **new** channel `gamemaster-question-tally` (cached, client-writable,
  echo-deduped); `gamemaster-correct-answers` is removed.

### Why a new key and channel instead of reshaping the old ones
Every PWA broadcasts its whole tally map on any local mutation. A stale installed PWA (`autoUpdate`
only lands on reload) would run the nested map through its flat normalizer, collapse every game to
`{ team1: 0, team2: 0 }`, persist that and re-broadcast it — silent data loss on every device,
terminated only by the server's echo-dedup rather than by anything noticing. Under a new name an old
peer merely fails to sync the tally, which is visible. There is deliberately **no legacy migration**.

### Known limitations
- `gamemaster-question-tally` has **no** Lamport `rev` guard (only `gamemaster-team-state` does), so it
  stays last-write-wins. Two gamemaster devices editing different rows at the same time can lose one
  edit. Pre-existing for this channel; out of scope here.
- Admin Session-tab point edits go through `SET_TEAM_STATE` and are **not** logged, so panel rows will
  not sum to the team total after a manual correction.
- A question nobody answered correctly is indistinguishable from a forgotten one. The panel is a review
  aid, which is why "keine Wertung" is styled muted rather than as an error.
- quizjagd's question number is a **turn** counter (`team1Count + team2Count + 1`). It is 1:1 with
  questions asked, so `Frage N` still reads correctly, but the teams alternate rather than both
  appearing on a row.
- wer-kennt-mehr in `standard` mode awards positional points at game end on its summary screen, where
  the last question is still the broadcast one — that award attributes to the last question rather than
  to a `Gesamt` row. The same class of accepted trade-off as the score-history over-show already
  documented for this game in [gamemaster-cockpit.md](gamemaster-cockpit.md).

## UI behaviour
- Component: `src/components/common/QuestionScorePanel.tsx`, rendered by `GamemasterView` after
  `CorrectAnswersTracker`.
- Collapsed: header + count of rows holding data. Expanded: one row per question, team columns in the
  gamemaster mirror order (the GM faces the crowd), values as counts or signed points.
- Edge cases: no data at all → the panel still renders while a game is running (its whole point is
  showing the gaps), but with rows only up to the current question; game change resets the row set via
  `gameIndex`; a GM reload restores everything from the cached channels.

## Out of scope
- A whole-show ledger in the admin Session tab (gamemaster zone only).
- Editing real point deltas from this panel — undo stays in "Letzte Wertungen".
- Player-facing display of the breakdown.
- Fixing the pre-existing BetQuiz re-judge double-award and the FinalQuiz reversal-under-clamp
  arithmetic. The `2×` marker makes both visible instead of netting them away.
