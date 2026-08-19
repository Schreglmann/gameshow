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
- [x] Optional `questionAudio`: auto-plays when the question is shown (e.g. "guess the release year of this song"). On-screen controls (timestamp, play/pause, restart) match simple-quiz's question audio; the gamemaster gets the same play/pause + restart buttons. Audio keeps playing through the result phase and stops when advancing to the next question; on game completion it fades out and the background music fades back in
- [x] The question audio can be trimmed: playback starts at `questionAudioStart`, stops at `questionAudioEnd`, and restarts at the start point when `questionAudioLoop` is set. The timestamp and the restart button are relative to the trimmed section. Admin picks the points on the shared `AudioTrimTimeline` waveform (the "✂ Trimmen" toggle in `GuessingGameForm`), and changing the audio file clears the trim
- [x] After the question, calls `onGameComplete()` (points awarded via `AwardPoints`)
- [x] Multiple questions per game are supported; host advances through them

## State / data changes
- No `AppState` changes — guess values are local component state
- Config type: `GuessingGameConfig` in `src/types/config.ts`
- Question type: `GuessingGameQuestion`
  - `question: string`
  - `answer: number` (must be numeric — validated by `validate-config.ts`)
  - `answerImage?: string`
  - `questionAudio?: string` (auto-played during the question)
  - `questionAudioStart?: number` / `questionAudioEnd?: number` / `questionAudioLoop?: boolean` (trim, same semantics as simple-quiz)

## UI behaviour
- Component: `src/components/games/GuessingGame.tsx`
- Two numeric inputs, one per team, labelled clearly, side by side in a two-column grid (`.guess-fields`) so the pair stays visible next to the question audio player
- "Reveal" button shows correct answer and highlights the winning team
- Result layout (`.guess-result`): the correct answer in a card on top, both teams side by side in a two-column grid below it, then the optional `answerImage`, then "Nächste Frage". The verdict is a gold "Näher dran!" badge on the winning team's card (a neutral "Gleichstand!" badge on both cards when the guesses are equidistant) — there is no separate winner banner, so the guesses are never sandwiched between two result blocks
- Visual indicator (colour/border) on the winning team's result card
- With `questionAudio`: the standard `.audio-controls` bar (timestamp / play-pause / restart) renders between question and inputs; playback uses `safePlay` + `watchMediaLoad` (asset resilience) and preloads the next question's audio via `usePreloadAsset`

## Out of scope
- Accepting non-numeric answers
- Automatic scoring (host still uses `AwardPoints` to award the game's full point value)
- Allowing teams to change their guess after submission
