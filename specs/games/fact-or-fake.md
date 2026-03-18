# Spec: Fact or Fake

## Goal
A statement is shown and teams must decide whether it is a real fact (FAKT) or made up (FAKE); after teams commit, the correct answer and an explanation are revealed.

## Acceptance criteria
- [x] One statement is shown per question
- [x] Two large buttons are displayed: "FAKT" and "FAKE"
- [x] Host presses the correct answer button (or uses keypress) to reveal the result
- [x] After reveal: the correct button is highlighted; a description/explanation is shown
- [x] Answer can be specified as `answer: 'FAKT' | 'FAKE'` or as `isFact: boolean` (both supported)
- [x] `description` field is shown as explanation text after reveal (required)
- [x] Questions can be randomised if `randomizeQuestions: true`
- [x] After the last question, calls `onGameComplete()`

## State / data changes
- No `AppState` changes
- Config type: `FactOrFakeConfig` in `src/types/config.ts`
- Question type: `FactOrFakeQuestion`
  - `statement: string`
  - `answer?: 'FAKT' | 'FAKE'`
  - `isFact?: boolean`
  - `description: string`

## UI behaviour
- Component: `src/components/games/FactOrFake.tsx`
- Statement displayed prominently in the centre
- Two large buttons below: FAKT (green tint) and FAKE (red tint)
- On reveal: correct button highlighted boldly; incorrect button dimmed; description shown below

## Out of scope
- Teams answering independently on devices
- Partial scoring
- Images alongside statements
