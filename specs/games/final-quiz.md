# Spec: Final Quiz

## Goal
A high-stakes betting round where teams wager their own points on each question; points are awarded or deducted inline per question rather than at the end of the game.

## Acceptance criteria
- [x] Questions are shown one at a time; host advances manually from question to betting phase
- [x] First question (`index 0`) is an **example round** — no points are awarded regardless of judgment
- [x] Host enters both teams' bet amounts via numeric input fields before the answer is revealed
- [x] "Antwort anzeigen" button reveals the answer and transitions to the judging phase
- [x] Host judges each team independently: **Richtig** (team earns their bet) or **Falsch** (team loses their bet)
- [x] Judgment can be changed after initial selection — previous award is reversed and new one applied
- [x] "Nächste Frage" / "Weiter" button is disabled until both teams have been judged
- [x] Points are awarded inline via `AWARD_POINTS` dispatch (no separate `AwardPoints` screen after this game)
- [x] `BaseGameWrapper`'s award-points phase is skipped (`skipPointsScreen`)
- [x] Optional `answerImage`: shown after reveal
- [x] After the last question, calls `onGameComplete()`

## State / data changes
- Inline point changes dispatch `AWARD_POINTS` directly from the component
- Config type: `FinalQuizConfig` in `src/types/config.ts`
- Question type: `FinalQuizQuestion`
  - `question: string`
  - `answer: string`
  - `answerImage?: string`

## UI behaviour
- Component: `src/components/games/FinalQuiz.tsx`
- **Question phase**: question text shown; click/Space/ArrowRight advances to betting phase
- **Betting phase**: two numeric inputs (one per team) for bet amounts; "Antwort anzeigen" button
- **Judging phase**: answer (+ optional `answerImage`) shown; Richtig/Falsch buttons for each team; "Nächste Frage" or "Weiter" button (disabled until both judged)
- Example question label: "Beispiel"; regular questions: "Frage N von M"
- Running point totals visible via `Header` (from `AppState.teams`)

## Out of scope
- Negative total points (enforced by reducer floor at 0)
- Timer per question
- Teams entering bets on their own devices
