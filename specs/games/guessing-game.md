# Spec: Guessing Game

## Goal
Both teams submit a numeric guess; the team whose answer is closest to the correct number wins the round.

## Acceptance criteria
- [x] Question is displayed with a prompt for both teams to write/say a number
- [x] Host enters both teams' guesses into separate input fields on the game screen
- [x] After both guesses are entered, host reveals the correct answer
- [x] The team with the closer guess is highlighted as the winner
- [x] In case of an exact tie (both equidistant), both teams are shown as tied
- [x] Optional `answerImage`: shown after the correct answer is revealed
- [x] After the question, calls `onGameComplete()` (points awarded via `AwardPoints`)
- [x] Multiple questions per game are supported; host advances through them

## State / data changes
- No `AppState` changes — guess values are local component state
- Config type: `GuessingGameConfig` in `src/types/config.ts`
- Question type: `GuessingGameQuestion`
  - `question: string`
  - `answer: number` (must be numeric — validated by `validate-config.ts`)
  - `answerImage?: string`

## UI behaviour
- Component: `src/components/games/GuessingGame.tsx`
- Two numeric inputs, one per team, labelled clearly
- "Reveal" button shows correct answer and highlights the winning team
- Visual indicator (colour/border) on the winning team's input

## Out of scope
- Accepting non-numeric answers
- Automatic scoring (host still uses `AwardPoints` to award the game's full point value)
- Allowing teams to change their guess after submission
