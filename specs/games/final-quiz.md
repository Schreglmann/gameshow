# Spec: Final Quiz

## Goal
A fast-paced buzzer-style round where teams answer questions quickly; points are awarded inline per question rather than at the end of the game.

## Acceptance criteria
- [x] Questions are shown one at a time; host advances manually
- [x] Host selects which team buzzed in first using large, clearly labelled team buttons
- [x] After selecting the team, the answer is revealed
- [x] Points are awarded or subtracted inline (no separate `AwardPoints` screen after this game)
- [x] `BaseGameWrapper`'s award-points phase is skipped for this game type
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
- Two large team buttons dominate the screen for quick selection
- After team selection: answer revealed, points updated immediately
- Running point totals visible (from `AppState.teams`)

## Out of scope
- Actual buzzer hardware integration
- Negative points for wrong answers (host decides manually)
- Timer per question
