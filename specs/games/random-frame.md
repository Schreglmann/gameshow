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

### Offline prerendered fallback (NAS-mounted videos)
- [ ] The admin Zufallsbild editor has a game-level **"Bilder herunterladen"** button that prerenders **3 frame variants per question** to the local cache so the show works at a live event where the source video (often NAS-only) is **not reachable**
- [ ] Prerendering resolves the source from local **or** the NAS mount (`<NAS_BASE>/videos/<rel>`); the live `GET /api/random-frame` keeps preferring the reachable source and only uses prerendered frames as a fallback
- [ ] **Frames are stored per question, not per video:** the manifest is keyed by `<videoRelPath>#<questionIndex>` (original, pre-shuffle index), so the same movie used in multiple questions gets its own independently-downloaded frames. The show sends the question's original index as `qindex`
- [ ] Clicking the button again **re-downloads fresh random frames** (refill), replacing the previous variants for each question
- [ ] A per-question badge shows whether that question's frames are prepared (✓ N Bilder / —); the button label flips to "Bilder neu herunterladen" once all questions are prepared
- [ ] Progress is streamed (SSE) and shown as a progress bar while the batch runs; a per-item failure (e.g. NAS unmounted, unreachable source) is reported but does not abort the rest of the batch
- [ ] **Fallback-only semantics:** when the real video is reachable the show always live-extracts (GM "Neues Bild" yields genuinely new frames); prerendered frames are served **only** when the source is unreachable, and then the GM rotate cycles the 3 downloaded variants (`variant % count`)
- [ ] **Downloaded-frame stopgap:** when a question is shown and the live frame is still loading after a short grace (~600 ms) AND a downloaded frame is available, the show displays the downloaded frame instead — and **keeps it even if the live frame finishes later**. This uses `GET /api/random-frame?...&prerendered=1`, which serves only the downloaded frame. When the live frame is warm (preloaded) it wins, so fresh images are still shown normally
- [ ] **Preview & mark-first (admin):** clicking a question's "✓ N Bilder" badge opens a modal previewing the downloaded frames in stable order. The frame marked "✓ Zuerst" is shown first offline; clicking another frame just moves the marker — `POST .../random-frame/prerender-select` sets a `first` index on the manifest entry, **never reordering or re-downloading** the files. The show maps its rotate counter through this marker (`files[(first + variant) % count]`)
- [ ] **Per-image reload (admin):** each frame in the preview has a "↻ Neu laden" button that re-extracts a fresh frame for that single variant (`POST .../random-frame/prerender-reload`, addressing the raw `slot`). It is **disabled when the source video is not reachable** (checked via `GET .../random-frame/source-reachable`)

## State / data changes
- No `AppState` changes — frame seeds are local state in the outer component (a random per-mount base seed + a per-question-index **rotate counter** map; the GM re-roll increments a question's counter, sent as the `variant` query param). The outer component (mounted from the title screen) also runs the in-order frame preloader
- Config type: `RandomFrameConfig` in `src/types/config.ts`
- `RandomFrameQuestion`: `{ video, answer, question?, answerImage?, frameStart?, frameEnd?, disabled? }`
- `GamemasterAnswerData` extended: new `questionImage?: string`; `nextAnswer` gains `image?: string`
- New HTTP route: `GET /api/random-frame?path=<rel>&start=<s>&end=<s>&seed=<n>&variant=<n>&qindex=<n>&prerendered=<0|1>` → streams `image/jpeg`. `variant` (default 0) is the GM rotate counter: for live extraction it is folded into the seed (`seed + variant`) so each rotate is a new frame; for the prerendered fallback it selects `variant % count` of the downloaded variants. `qindex` is the question's original index (prerendered frames are matched per question). `prerendered=1` serves only the downloaded frame (skips live extraction; 404 if none)
- Extracted frames cached to `VIDEO_CACHE_BASE/frames/<slug>__<seed+variant>.jpg`
- Prerendered fallback frames (per question): `VIDEO_CACHE_BASE/frames/prerendered/<slug>__q<index>__p<0..2>.jpg`, indexed by a manifest sidecar `VIDEO_CACHE_BASE/frames/.prerender.json` keyed by `<relPath>#<questionIndex>` (`{ [key]: { files: string[]; first?: number } }`, where `first` is the variant shown first — a marker, files are never reordered); local-only, never mirrored to NAS. Persistence + selection helpers live in [server/random-frame-prerender.ts](../../server/random-frame-prerender.ts)
- New admin routes (admin zone): `POST /api/backend/assets/videos/random-frame/prerender` (body `{ items: [{ path, index, frameStart?, frameEnd? }], count? }` → SSE `data:{ percent }` … `{ done }`/`{ error }`) and `GET /api/backend/assets/videos/random-frame/prerender-status?keys=a%230|b%231` → `{ status: { [key]: number } }`

## UI behaviour
- Component: `src/components/games/RandomFrame.tsx` (wraps `BaseGameWrapper`)
- Frame rendered via `<RetryImage>` for load resilience, responsive (`max-height: 60vh`), border-radius — reuses the `.image-guess-*` styling. A centered spinner overlay (`.random-frame-loading`, reusing `.video-loading-spinner`) covers the container until the frame loads (the `<img>` fades in on load); the container reserves a min-height so there's no layout jump
- Answer shown in `.quiz-answer` below the frame; `answerImage` shown alongside the answer text
- Gamemaster (`GamemasterView`): `questionImage` rendered at top of card and `nextAnswer.image` inside the next-answer block, both via `GmPreviewImage` (shows a spinner while a re-rolled frame loads, and clears it immediately for an already-cached frame — e.g. the re-rolled next image becoming the current image — so the spinner never gets stuck) and both gated by the `showAnswerImages` toggle; regenerate buttons ("Neues Bild" / "Neues nächstes Bild") registered as a gamemaster `button-group`
- Admin form `RandomFrameForm.tsx`: per question a video picker (`AssetField` category `videos`), answer text, optional question text, optional answer-image picker, and two numeric inputs for `frameStart`/`frameEnd` (placeholders noting the runtime-fraction defaults: 5 % / 92 %). A top toolbar holds the **"Bilder herunterladen"** button (prerender all questions with a progress bar, refresh status on completion) and each prepared question shows a ✓ badge
- Client API: `prerenderRandomFrames(items, onEvent, count?, signal?)` (POST + SSE reader) and `getRandomFramePrerenderStatus(paths)` in `src/services/backendApi.ts`

## Out of scope
- Trimming/encoding the video or playing it back (this is a still-frame game, not video-guess)
- Persisting which exact frame was shown across server restarts (frames are cache-by-seed only)
- Automatic movie-title detection or scene selection by content
