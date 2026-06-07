# Spec: Random Frame

## Goal
Teams see a single random still frame extracted at runtime from a video the host picked, and guess which movie/show it is from; a fresh random frame can be re-rolled on demand by the gamemaster (e.g. when the picked frame is black).

## Acceptance criteria
- [x] Questions are defined in the game JSON with `video` (DAM path), `answer` (string), optional `question`, `answerImage`, `frameStart`, `frameEnd`, `disabled`
- [x] First question is treated as the example (kept on top); `disabled` questions are filtered; honours shared `randomizeQuestions` + `questionLimit` via `useShuffledQuestions`
- [x] At runtime the show requests a random frame from the server and displays it; an optional `question` prompt (default `"Aus welchem Film stammt dieses Bild?"`) is shown above it
- [x] The server picks a pseudo-random timestamp within the question's bounds and extracts that single frame with ffmpeg. When a bound is unset it defaults to a **fraction of the real runtime** (start = 5 %, end = 92 %) so the frame is genuinely random across the whole film rather than a fixed early window; fixed seconds (180 / 900) are used only as a fallback when the duration can't be probed
- [x] The server automatically skips near-black / near-uniform frames: it samples up to 4 candidate timestamps and returns the first non-black one (falling back to the first candidate)
- [x] Frames are random per play: a fresh random base seed is generated once when the game mounts (the title screen), so each play / page reload shows genuinely different frames. The seed is stable within a play (re-renders and back-nav reuse the same cached frame); the GM "Neues Bild" / "Nächstes Bild" buttons re-roll a single question's frame
- [x] On the title screen the show preloads every question's frame in order (sequentially, one at a time) so the server extracts + caches them ahead of time and the early questions are already warm by the time the host advances
- [x] Extraction is fast: one full-priority ffmpeg spawn per candidate (no `bgProcessPrefix` demotion, no separate probe pass), frames downscaled to ≤1280px wide, result cached to disk; the show displays a loading spinner ("Bild wird geladen…") until the frame arrives
- [x] Host advance (ArrowRight/click) reveals the answer: `answer` text + optional `answerImage`
- [x] Next advance after answer → next question (new random frame); back navigation mirrors ImageGuess (answer shown → hide; else previous question with answer shown)
- [x] After the last question + answer revealed, calls `onGameComplete()`
- [x] Gamemaster screen shows the exact current frame (`questionImage`) plus a "Neues Bild" button that re-rolls the frame on both the show and the GM
- [x] While the current answer is revealed, the gamemaster next-answer preview shows the NEXT question's frame and a "Neues nächstes Bild" button re-rolls it
- [x] The GM frame previews (current + next) are gated by the GM "Bilder einblenden/ausblenden" toggle (`showAnswerImages`), like the answer image
- [x] When a GM frame is re-rolled, the GM preview dims the old frame and shows a spinner while the new one is extracted, so the host gets immediate feedback
- [x] Points awarded by the host via `AwardPoints` (value = `currentIndex + 1`)
- [x] Validator requires `video` + `answer`; validates optional numeric `frameStart`/`frameEnd`

## State / data changes
- No `AppState` changes — frame seeds are local state in the outer component (a random per-mount base + a per-question-index override map; re-roll bumps a question's entry). The outer component (mounted from the title screen) also runs the in-order frame preloader
- Config type: `RandomFrameConfig` in `src/types/config.ts`
- `RandomFrameQuestion`: `{ video, answer, question?, answerImage?, frameStart?, frameEnd?, disabled? }`
- `GamemasterAnswerData` extended: new `questionImage?: string`; `nextAnswer` gains `image?: string`
- New HTTP route: `GET /api/random-frame?path=<rel>&start=<s>&end=<s>&seed=<n>` → streams `image/jpeg`
- Extracted frames cached to `VIDEO_CACHE_BASE/frames/<slug>__<seed>.jpg`

## UI behaviour
- Component: `src/components/games/RandomFrame.tsx` (wraps `BaseGameWrapper`)
- Frame rendered via `<RetryImage>` for load resilience, responsive (`max-height: 60vh`), border-radius — reuses the `.image-guess-*` styling. A centered spinner overlay (`.random-frame-loading`, reusing `.video-loading-spinner`) covers the container until the frame loads (the `<img>` fades in on load); the container reserves a min-height so there's no layout jump
- Answer shown in `.quiz-answer` below the frame; `answerImage` shown alongside the answer text
- Gamemaster (`GamemasterView`): `questionImage` rendered at top of card and `nextAnswer.image` inside the next-answer block, both via `GmPreviewImage` (shows a spinner while a re-rolled frame loads) and both gated by the `showAnswerImages` toggle; regenerate buttons ("Neues Bild" / "Neues nächstes Bild") registered as a gamemaster `button-group`
- Admin form `RandomFrameForm.tsx`: per question a video picker (`AssetField` category `videos`), answer text, optional question text, optional answer-image picker, and two numeric inputs for `frameStart`/`frameEnd` (placeholders noting the runtime-fraction defaults: 5 % / 92 %)

## Out of scope
- Trimming/encoding the video or playing it back (this is a still-frame game, not video-guess)
- Persisting which exact frame was shown across server restarts (frames are cache-by-seed only)
- Automatic movie-title detection or scene selection by content
