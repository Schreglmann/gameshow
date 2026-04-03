# Spec: Video Guess

## Goal
Teams watch a video clip played from a start marker to a question marker; the host reveals the answer (text), and optionally continues playback from the question marker to an end marker as a visual answer.

## Acceptance criteria
- [ ] Questions are defined in the game JSON file, like all other quiz types
- [ ] Each question has: `answer` (string), `video` (path to file in `/videos/` DAM), `videoStart` (seconds — where playback begins), `videoQuestionEnd` (seconds — where the clip pauses for the question), optional `videoAnswerEnd` (seconds — where the answer segment ends), optional `answerImage` (path to image shown on reveal), optional `disabled` (boolean)
- [ ] The first question is always treated as the example (not selectable)
- [ ] Video plays automatically when a question loads — from `videoStart` to `videoQuestionEnd`, then pauses
- [ ] On reveal (host advances): the answer text is shown; if `videoAnswerEnd` is set, playback resumes from `videoQuestionEnd` to `videoAnswerEnd`
- [ ] Host can replay the question clip via a button at any time before reveal
- [ ] Background music fades out when the rules phase starts (`onRulesShow`); fades back in when transitioning to the award-points phase after the last question (`onNextShow`)
- [ ] After the last question, calls `onGameComplete()`
- [ ] Video files use the normal `/videos/` DAM — already served by the server
- [ ] Validator requires `questions` array with `answer` and `video` fields

## State / data changes
- No `AppState` changes — playback state is local
- Config type: `VideoGuessConfig` in `src/types/config.ts`
- `VideoGuessQuestion`: `{ answer, video, videoStart?, videoQuestionEnd?, videoAnswerEnd?, answerImage?, disabled? }`
- Questions defined in game JSON files under `games/`
- Videos served from: `/videos/` static path (normal videos DAM)

## UI behaviour
- Component: `src/components/games/VideoGuess.tsx`
- Single `<video>` element per question
- Question clip plays from `videoStart` (default 0) to `videoQuestionEnd` (pauses via timeupdate)
- On reveal: answer text shown below/above video; if `videoAnswerEnd` is set, video resumes from `videoQuestionEnd` to `videoAnswerEnd`; if `answerImage` is set, image displayed alongside answer text
- "Clip wiederholen" button replays the question segment (hidden after reveal)
- Navigation: ArrowRight reveals answer (first press) then advances to next question (second press); ArrowLeft un-reveals or goes back
- Back-navigation returns to previous question in revealed state with answer video segment playing

## Out of scope
- Admin backend form (can be added later)
- Score tracking per clip (handled by `AwardPoints` after the game)
