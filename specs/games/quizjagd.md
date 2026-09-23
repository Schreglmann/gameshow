# Spec: Quizjagd

## Goal
A turn-based quiz where each team alternately selects a difficulty level (easy/medium/hard), answers the corresponding question, and earns or loses points inline — without a separate `AwardPoints` screen.

## Acceptance criteria
- [x] Teams alternate turns; each team picks a difficulty for their question
- [x] Three difficulty levels: easy (3 points), medium (5 points), hard (7 points)
- [x] Correct answer: team earns the difficulty's point value via inline `AWARD_POINTS` dispatch
- [x] Wrong answer: team loses the difficulty's point value (points floor at 0)
- [x] The host marks the answer correct or incorrect; no automatic checking
- [x] `BaseGameWrapper`'s award-points phase is skipped (inline scoring only)
- [x] Supports flat config format: questions have a `difficulty: 3 | 5 | 7` field
- [x] Supports structured config format: `{ easy: Question[], medium: Question[], hard: Question[] }`
- [x] Example questions (marked as examples in config) are shown first and are not shuffled
- [x] Non-example questions within each difficulty level are shuffled independently
- [x] Each team answers a configurable number of questions (default: 10 total per team)
- [x] After all questions are exhausted or a round limit is reached, calls `onGameComplete()`
- [x] **The game can never dead-end.** If all three difficulty pools run dry while the betting
      phase is still active — i.e. before both teams have had `questionsPerTeam` turns — the game
      calls `onGameComplete()` instead of leaving the host on the difficulty screen with every
      button disabled. Quizjagd registers no `backNavHandler`, so without this the only input that
      did anything was ArrowLeft, which dropped `BaseGameWrapper` to the rules phase and unmounted
      the round.
- [x] **`npm run validate` rejects a config that cannot supply the game.** The first entry of each
      pool is its Beispielfrage and is never played, so the playable count is
      `Σ(pool.length − 1)` and it must be at least `questionsPerTeam × 2`. The validator also
      checks that each pool is a non-empty array of `{ question, answer }`, and — in the flat
      format — that every `difficulty` is 3, 5 or 7. Before this, quizjagd files were not
      validated at all: neither shape was covered by `typesNeedingQuestions`, so a malformed pool
      passed validation and white-screened the show at that round.

## State / data changes
- Inline point changes dispatch `AWARD_POINTS` directly from the component
- Config type: `QuizjagdConfig` in `src/types/config.ts`
- Two supported question formats:
  - Flat: `{ question: string; answer: string; difficulty: 3 | 5 | 7; isExample?: boolean }`
  - Structured: `{ easy: Q[]; medium: Q[]; hard: Q[] }` where each Q has `question`, `answer`, optional `isExample`

## UI behaviour
- Component: `src/components/games/Quizjagd.tsx`
- Difficulty selection screen: three buttons per turn showing point values
- After difficulty selected: question shown with "Richtig" / "Falsch" buttons
- Point change animated/shown inline
- Whose turn it is displayed clearly
- Running totals visible at all times

## Out of scope
- Teams choosing difficulty for their opponent
- Time limits per question
- Questions worth anything other than 3/5/7 points

## Team count
**1–4 teams.** The turn order is a round-robin over the active teams, each team's asked-question
count is tracked separately, and the game ends once every team has had `questionsPerTeam` questions —
so the pools must supply `questionsPerTeam × teamCount` playable questions (a validator warning, not
an error, since one file may serve gameshows with different counts).
See [../team-count.md](../team-count.md).
