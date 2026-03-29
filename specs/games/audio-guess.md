# Spec: Audio Guess

## Goal
Teams listen to short audio clips and guess what song, sound, or artist is being played; questions are defined in JSON config with audio trim markers — `audioStart`/`audioEnd` define the short clip, and `audioStart` is also used as the start position for the long version.

## Acceptance criteria
- [x] Questions are defined in the game JSON file, like all other quiz types
- [x] Each question has: `answer` (string), `audio` (path to file in `/audio/` DAM), optional `audioStart`/`audioEnd` (trim markers for short clip), optional `isExample` (boolean)
- [x] The first question (or any question with `isExample: true`) is treated as an example
- [x] Audio plays automatically when the question phase begins — short clip plays from `audioStart` to `audioEnd`
- [x] On reveal, the long version auto-plays from `audioStart` to end of file
- [x] Host can replay short clip or play long version via buttons at any time
- [x] Host reveals the answer by advancing; the `answer` field text is shown
- [x] Background music fades out when the rules phase starts (`onRulesShow`); fades back in when transitioning to the award-points phase after the last clip (`onNextShow`), consistent with `specs/background-music.md`
- [x] After the last clip, calls `onGameComplete()`
- [x] Audio files use the normal `/audio/` DAM — no separate `audio-guess` DAM category
- [x] Admin form (`AudioGuessForm`) allows editing questions with answer, audio picker, and trim timeline for short clip
- [x] Validator requires `questions` array with `answer` and `audio` fields

## State / data changes
- No `AppState` changes — playback state is local
- Config type: `AudioGuessConfig` in `src/types/config.ts`
- `AudioGuessQuestion`: `{ answer, audio, audioStart?, audioEnd?, isExample? }`
- Questions defined in game JSON files under `games/`
- Audio served from: `/audio/` static path (normal audio DAM)

## UI behaviour
- Component: `src/components/games/AudioGuess.tsx`
- Two `<audio>` elements sharing the same source file: one for short clip (with trim), one for long version
- Short clip plays from `audioStart` to `audioEnd` (timeupdate stops at end)
- Long version plays from `audioStart` to end of file
- "Ausschnitt wiederholen" button replays the short clip from `audioStart`
- "Ganzer Song" button plays from `audioStart`
- On reveal: long version auto-plays only if not already playing (continues seamlessly if long version was started manually); answer text is shown without control buttons
- Back-navigation returns to the previous question with the long version playing

## Out of scope
- Filesystem-driven questions (replaced by JSON config)
- Video clips
- Score tracking per clip (handled by `AwardPoints` after the game)
