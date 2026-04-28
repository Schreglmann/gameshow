# Spec: Bandle

## Goal
Teams guess songs by hearing instruments revealed one at a time (drums first, then drums+bass, etc.); fewer instruments needed = better — inspired by bandle.app.

## Acceptance criteria
- [ ] Questions are defined in the game JSON file with `tracks[]` array
- [ ] Each question has: `answer` (string), `tracks` (array of `{ label, audio }`), optional `hint` (string), optional `answerImage`, optional `isExample`, optional `disabled`
- [ ] Each track has a `label` (instrument name shown on screen) and `audio` (path to pre-mixed MP3)
- [ ] Track 1 plays automatically when the question loads
- [ ] Host advances (right arrow) to reveal the next track — new audio plays automatically
- [ ] Host can skip to answer at any time via "Auflösen" button
- [ ] If a question has a `hint` and `hintEnabled: true`, after all tracks are revealed, right arrow shows the hint text as a "Hinweis" stage before the answer. Hints are off by default and toggled per-question in the admin
- [ ] During the hint stage, the last audio track keeps playing; if audio has stopped, it auto-replays; audio controls remain visible
- [ ] When advancing to the answer stage, if the last track's audio has stopped, it auto-replays
- [ ] "Hinweis" appears as an amber-colored pill in the track indicators (after all audio track pills)
- [ ] "Auflösen" skips past the hint directly to the answer
- [ ] When all tracks are revealed (and hint shown, if present) or host clicks "Auflösen", the answer is shown
- [ ] After answer, next right arrow moves to the next question
- [ ] Back navigation (left arrow) reverses: hide answer → hint (if present) → reduce tracks → previous question
- [ ] "Nochmal abspielen" button replays the current track
- [ ] Audio timeline shows a progress bar with current time / total duration for the playing track
- [ ] Replay and solve controls use the subtle `audio-controls` pill style (matching SimpleQuiz), not full-size buttons
- [ ] Track progress indicators show revealed/current/hidden tracks as labeled pills
- [ ] Clicking a revealed track pill replays that track
- [ ] Clicking an unrevealed track pill reveals all tracks up to and including it (and plays the clicked track)
- [ ] Long-pressing ArrowRight (500ms) during gameplay jumps directly to the answer (for presenter-only mode)
- [ ] Background music fades out on rules show; fades back in on transition to award-points
- [ ] After the last question's answer, calls `onGameComplete()`
- [ ] Validator requires `questions` array; each question needs `answer` and non-empty `tracks` with `label` and `audio`
- [ ] UI is responsive at 375px, 768px, 1024px, and 1920px

## State / data changes
- No `AppState` changes — playback state is local to the component
- Config type: `BandleConfig` in `src/types/config.ts`
- `BandleTrack`: `{ label: string, audio: string }`
- `BandleQuestion`: `{ answer, tracks, hint?, hintEnabled?, answerImage?, isExample?, disabled? }`
- Audio served from: `/audio/bandle/` static path
- Persisted to localStorage: no

## UI behaviour
- Component: `src/components/games/Bandle.tsx`
- Song counter: "SONG X VON Y" at top
- Horizontal track indicators: labeled pills arranged in a row
  - Revealed tracks: solid gradient fill, instrument name visible
  - Current track: pulsing glow animation
  - Hidden tracks: dim outline, no label
- Single `<audio>` element — switches `src` when revealing next track
- Audio timeline: thin progress bar under track indicators, shows elapsed / duration in compact pill
- Replay + solve controls: compact `audio-controls` pill bar (play/pause, restart, solve icon) — same visual language as SimpleQuiz audio controls
- Track pills are clickable: revealed pills replay that track, unrevealed pills reveal up to that stage
- Answer reveal: song title + optional cover image with fade-in animation
- Edge cases:
  - Songs can have variable number of tracks (3–6)
  - First question with `isExample: true` is treated as example
  - Disabled questions are filtered out (first question preserved)

## DAM integration
- The `bandle` subfolder under `local-assets/audio/` is hidden from the DAM asset picker (browsing and search) — bandle assets are managed exclusively via the bandle catalog picker

## Out of scope
- Web Audio API / layered stem playback (using pre-mixed tracks instead)
- Per-question scoring (handled by `AwardPoints` after the game)
- Automatic song recognition / guessing input
