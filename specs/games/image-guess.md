# Spec: Image Guess

## Goal
Teams guess what an image shows as it is progressively de-obfuscated on an automatic timer; the host reveals the answer when ready — guessing earlier (more obfuscated) is more impressive.

## Acceptance criteria
- [ ] Questions are defined in the game JSON file with `image` (path), `answer` (string), optional `answerImage`, `obfuscation`, `steps`, `duration`, `zoomOrigin`, `isExample`, `disabled`
- [ ] First question (or `isExample: true`) is treated as example
- [ ] Image starts at maximum obfuscation; a timer automatically reduces obfuscation by one step every `duration / steps` seconds (default 15s / 5 steps = 3s per step)
- [ ] Three obfuscation modes: `blur` (CSS filter, default), `pixelate` (canvas at reduced resolution), `zoom` (CSS scale + overflow hidden with configurable transform-origin)
- [ ] Smooth CSS transitions between blur/zoom levels (0.6s ease-out); pixelate snaps between levels
- [ ] Step indicator ("Stufe X von Y") updates as timer progresses; hidden when answer is revealed
- [ ] At any point, host advance (ArrowRight/click) reveals answer: image jumps to fully clear, answer text shown
- [ ] If `answerImage` is set, it replaces the question image on reveal
- [ ] Next advance after answer → next question (timer restarts at max obfuscation)
- [ ] Back navigation: if answer shown → hide answer (image stays clear); if no answer shown → previous question with answer shown
- [ ] Background music fades out at rules (`onRulesShow`), fades back in after last question (`onNextShow`)
- [ ] After last question + answer revealed, calls `onGameComplete()`
- [ ] Validator requires `answer` and `image` fields; validates optional `obfuscation`, `steps`, `duration`
- [ ] Lightbox available on revealed (clear) image via click
- [ ] Gamemaster screen receives answer data via `setGamemasterData`

## State / data changes
- No `AppState` changes — timer and obfuscation state are local
- Config type: `ImageGuessConfig` in `src/types/config.ts`
- `ImageGuessQuestion`: `{ image, answer, answerImage?, obfuscation?, steps?, duration?, zoomOrigin?, isExample?, disabled? }`
- Questions defined in game JSON files under `games/`
- Images served from `/images/` static path (normal images DAM)

## UI behaviour
- Component: `src/components/games/ImageGuess.tsx`
- Image container with `overflow: hidden`, responsive sizing (`max-height: 60vh`), border-radius
- Blur mode: `<img>` with CSS `filter: blur(Npx)`, transition between levels
- Pixelate mode: `<canvas>` redrawn at progressively higher resolution, `imageSmoothingEnabled: false`
- Zoom mode: `<img>` with CSS `transform: scale(N)`, `transform-origin` from config or random (20%-80% range)
- On reveal: answer text in `.quiz-answer` div below image; answerImage replaces question image if set
- Click on clear image opens `Lightbox` component (existing)

## Out of scope
- Combination effects (blur + zoom simultaneously)
- Audio integration (no sound effects for reveal)
- Admin form for editing questions (will be added as separate task)
- Custom animation curves per question
