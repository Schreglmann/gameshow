# Spec: Film stripe (Filmstreifen)

## Goal
A whole film is shown as one stripe of colours — one line per moment, left to right in film order — and the teams name the film; a time-lapse of stills is the hint.

## Acceptance criteria

### Stripe computation (server)
- [x] A stripe is computed per **video**, not per question: nothing about it is random, so two questions on the same film share one
- [x] The film is sampled at 240 evenly spaced moments inside 3 %–93 % of its runtime (skips studio logos and most of the credits). Each sampled frame is reduced to its average colour
- [x] Every 5th sampled frame is also kept as a JPEG at most 640 px wide: 48 stills, the time-lapse
- [x] The result is cached locally in `local-assets/videos/.cache/film-stripe/<slug>/`: `stripe.json` (colours, still count, the position of each still on the stripe, size + mtime of the source file, sampled window) and `frame-NN.jpg`
- [x] A build writes into a temporary directory and swaps it in, so a failed build leaves the previous stripe in place
- [x] A frame that cannot be decoded takes the colour of the frame before it; a build fails only when more than 30 % of the frames are missing
- [x] **The show never computes.** `GET /api/game/:index` attaches the cached stripe to each question as `stripe: { colors, frames, framePositions }` and `GET /api/film-stripe/frame` serves stills from the cache; neither touches the source file. A film without a cached stripe comes without the field
- [x] Each sample is a keyframe seek (`-noaccurate_seek`): the keyframe at or before the timestamp is taken instead of decoding forward to the exact frame. On a 4K HEVC film the frames in between were most of the work (5:12 → 3:17 for one film)
- [x] ffmpeg runs through `spawnBackgroundFfmpeg` (low priority), three seeks at a time. Every spawn has an `'error'` listener and is killed after 45 s — a read from a stale NAS mount does not return on its own
- [x] An HDR source is tone-mapped (`buildTonemapVf`) before the colour is taken; without it every colour comes out grey. The tone map runs after the downscale to 640 px — on the full 4K frame it costs seconds per frame
- [x] The source is resolved with `resolveVideoPathWithNas` and stat'ed through the bounded NAS helper; no synchronous NAS I/O
- [x] A stripe counts as outdated when the source file's size or mtime differs from the recorded one. A source that cannot be read (NAS unmounted) never makes a stripe outdated
- [x] Replacing or deleting a video removes its stripe (`deleteCacheFilesForVideo`)
- [x] Two prepare requests for the same film share one build

### Admin
- [x] The question form has a "Streifen berechnen" bar: one button for all films of the instance, a progress bar that moves during a single film, the film being worked on, and an "x/y Filme vorbereitet" count
- [x] Films with a current stripe are skipped; when every stripe is current the button reads "Streifen neu berechnen" and recomputes all of them
- [x] Each question shows its stripe as a preview strip under the video field, "kein Streifen berechnet" when there is none (with "Video nicht erreichbar" when that is the reason), and a warning when the stripe is outdated
- [x] Picking a video fills an empty answer from the file name
- [x] The job appears in the System tab as a background task

### Show
- [x] Questions are defined in the game JSON with `video`, `answer`, and optional `question`, `answerImage`, `gmInfo`, `disabled`
- [x] A film opens with the stripe alone; it wipes in from the left over 5 s
- [x] First host advance: the time-lapse plays above the stripe at 6 stills per second and loops; the stripe shrinks to a timeline and a marker shows where the current still sits
- [x] Next host advance: the answer and the optional `answerImage` (the poster) appear, the time-lapse stops, the stripe stays
- [x] Back navigation mirrors the forward steps: answer → time-lapse → stripe → previous film with its answer shown
- [x] Holding ArrowRight/Space (≥500 ms) or the gamemaster "Auflösung" button jumps to the answer
- [x] The stills of the current film are prefetched with `fetch()` as soon as the film is on stage, three at a time; the time-lapse plays only the contiguous run that has arrived
- [x] A film without a computed stripe shows "Für diesen Film wurde noch kein Farbstreifen berechnet." and the first advance reveals the answer
- [x] Play index 0 is the `Beispiel` question; the counter reads `Film N von M` for the rest
- [x] Honors `randomizeQuestions` + `questionLimit` via `useQuestionOrder` and tracks the position with `useLiveQuestionIndex`; per-question state is keyed on `qKey`
- [x] After the last answer, calls `onGameComplete()`; points via `AwardPoints`, scorable at 0–4 teams, feeds the correct-answer tally
- [x] Gamemaster card: prompt, answer, poster, next-film preview. Controls: "Zeitraffer" (`film-stripe-timelapse`, toggles the hint and leaves the answer; disabled without stills) and "Auflösung" (`film-stripe-reveal`)
- [x] The stripe's height is a share of the viewport height (`26vh`, 96–300 px; `8vh` as a timeline), so the answer stays on screen on a wide projector
- [x] The wipe-in and the height change are skipped under `prefers-reduced-motion`
- [x] Validator: `video` is a path starting with `/videos/`, `answer` is non-empty

## State / data changes
- No `AppState` changes, no new WebSocket channel
- New types in `src/types/config.ts`: `FilmStripeData`, `FilmStripeQuestion`, `FilmStripeConfig`; `'film-stripe'` joins the `GameType` union and `FilmStripeConfig` the `GameConfig` union
- New routes (documented in `specs/api/openapi.yaml`):
  - `GET /api/film-stripe/frame?path=<rel>&i=<n>` — show zone, one still from the cache, 404 when not computed
  - `GET /api/backend/assets/videos/film-stripe/status?paths=a|b` — admin zone
  - `POST /api/backend/assets/videos/film-stripe/prepare` — admin zone, body `{ paths, force? }`, SSE progress
- New background-task type `film-stripe`
- `server/film-stripe.ts` holds sampling, colour maths, the cache layout and the frame extractor; it does no NAS I/O of its own

## UI behaviour
- Show component: `src/components/games/FilmStripe.tsx`, wrapped in `BaseGameWrapper`
- Stripe: `src/components/common/FilmStripeBar.tsx` — SVG rects on a viewBox one unit per colour, stretched with `preserveAspectRatio="none"`. In `common/` so the admin preview and the theme showcase reuse it
- Admin form: `src/components/backend/questions/FilmStripeForm.tsx`
- Default prompt: "Welcher Film ist das?"
- Rules: Archetype B with the task line in `specs/rules-standard.md`
- Measured on a local SSD: 10 s for a 20-second clip, 3:17 for a 15 GB 4K HEVC HDR film of 2.5 hours. A 1080p film falls in between; a film read from the NAS takes longer. Stripes have to be computed before the show; the example game's stripe is computed by `npm run fixtures`

## Out of scope
- Computing a stripe during a show
- Mirroring the stripe cache to the NAS
- Cropping letterbox bars before averaging (hard-coded black bars darken every colour a little)
- A per-question sampling window
- Filling `answerImage` with the poster automatically
