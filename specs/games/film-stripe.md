# Spec: Film stripe (Filmstreifen)

## Goal
A whole film is shown as one stripe of colours — one line per moment, left to right in film order — and the teams name the film; a time-lapse of stills is the hint.

## Acceptance criteria

### Stripe computation (server)
- [x] A stripe is computed per **video**, not per question: nothing about it is random, so two questions on the same film share one
- [x] The film is sampled at 240 evenly spaced moments inside 3 %–93 % of its runtime (skips studio logos and most of the credits). Each sampled frame is reduced to one colour (below)
- [x] Every 5th sampled frame is also kept as a JPEG at most 640 px wide: 48 stills, the time-lapse
- [x] The result is cached locally in `local-assets/videos/.cache/film-stripe/<slug>/`: `stripe.json` (colours, still count, the position of each still on the stripe, size + mtime of the source file, sampled window) and `frame-NN.jpg`
- [x] A build writes into a temporary directory and swaps it in, so a failed build leaves the previous stripe in place
- [x] A frame that cannot be decoded takes the colour of the frame before it; a build fails only when more than 30 % of the frames are missing
- [x] A finished build sends `content-changed` with `filmStripes: true`; the show re-fetches the current game, so a stripe computed while the show is open appears without a reload (a film on screen that read "noch kein Farbstreifen" switches to its stripe in place)
- [x] **The show never computes.** `GET /api/game/:index` attaches the cached stripe to each question as `stripe: { colors, frames, framePositions }` and `GET /api/film-stripe/frame` serves stills from the cache; neither touches the source file. A film without a cached stripe comes without the field
- [x] Each sample is a keyframe seek (`-noaccurate_seek`): the keyframe at or before the timestamp is taken instead of decoding forward to the exact frame. On a 4K HEVC film the frames in between were most of the work (5:12 → 3:17 for one film)
- [x] ffmpeg runs through `spawnBackgroundFfmpeg` (low priority), three seeks at a time. Every spawn has an `'error'` listener and is killed after 45 s — a read from a stale NAS mount does not return on its own
- [x] An HDR source is tone-mapped (`buildTonemapVf`) before the colour is taken; without it every colour comes out grey. The tone map runs after the downscale to 640 px — on the full 4K frame it costs seconds per frame
- [x] The source is resolved with `resolveVideoPathWithNas` and stat'ed through the bounded NAS helper; no synchronous NAS I/O
- [ ] A frame's colour is its **saturation-weighted** average: every pixel counts with weight `chroma² + 0.01` (chroma = (max − min) / 255 of its RGB), summed in linear light, then the colour's OKLab chroma is raised by 1.4 (less when that leaves the sRGB gamut). A plain average turned most frames grey-brown because a frame's few strong colours were mixed with its large grey and dark areas; weighting lets the colour that is there win, and the `0.01` floor keeps the grey of a frame that has no colour. Chosen by a side-by-side comparison of five methods on six films (plain average, linear light + saturation, Moviebarcode-style rows, rows + saturation, saturation-weighted)
- [ ] The frame is scaled to 200 px wide before the colour is taken (the still keeps 640 px)
- [x] A stripe counts as outdated when the source file's size or mtime differs from the recorded one. A source that cannot be read (NAS unmounted) never makes a stripe outdated
- [ ] A stripe computed with an older method (`version` below `FILM_STRIPE_VERSION`, currently 2) is still read and shown, but counts as outdated, so "Streifen berechnen" recomputes it without forcing. A version above the current one (a newer server's cache) reads as absent
- [x] Replacing or deleting a video removes its stripe (`deleteCacheFilesForVideo`)
- [x] Two prepare requests for the same film share one build

### Admin
- [x] The question form has a "Streifen berechnen" bar: one button for all films of the instance, a progress bar that moves during a single film, the film being worked on, and an "x/y Filme vorbereitet" count
- [x] Films with a current stripe are skipped; when every stripe is current the button reads "Streifen neu berechnen" and recomputes all of them
- [x] Only the films that need work are sent (missing or outdated stripe; all of them on "neu berechnen"), so the run's count and its time estimate cover real work only
- [x] While a run is going the bar shows the batch progress (the current film's progress blended in), `Film x/y`, the film's title with its own percent, the elapsed time and, from 2 % of the batch on, `noch ca. …`. The estimate extrapolates the time spent per film; a film that failed counts as no work
- [x] A stripe appears in its question's preview as soon as its film is done, not at the end of the batch; the "x/y Filme vorbereitet" count follows it
- [x] Each question shows its film's part in the run: `wird berechnet · 42 %` with a small bar, `in Warteschlange`, and — until the next run — the error of a film that failed
- [x] A `prepare` stream that ends without its `done` event (server restart, lost connection) is reported as aborted, not as finished; starting again skips the films that are done
- [x] The form follows a run through the `system-status` WebSocket (the task's `meta.filmStripe`): opened while a run is going (after a tab switch, in a second browser tab) it shows the same progress, disables the button and refreshes each stripe as its film finishes. The `prepare` stream's first event names the task (`{ taskId }`), so the form that started a run ignores that task's WebSocket copy
- [x] Each question shows its stripe as a preview strip under the video field, "kein Streifen berechnet" when there is none (with "Video nicht erreichbar" when that is the reason), and a warning when the stripe is outdated (the video file changed, or the stripe was computed with an older method)
- [x] Picking a video fills an empty answer from the file name
- [x] The job appears in the System tab as a background task. Its detail leads with the batch percent (`47 % · Film 2/3 · Dune.m4v 42 %`), so the row's bar and its ETA cover the whole batch, not the current film
- [x] The `system-status` broadcast is debounced with a trailing send, so the last change of a burst (a film finishing, the task ending) always reaches the admin

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
- No `AppState` changes, no new WebSocket channel; `content-changed` gains the flag `filmStripes`
- New types in `src/types/config.ts`: `FilmStripeData`, `FilmStripeQuestion`, `FilmStripeConfig`; `'film-stripe'` joins the `GameType` union and `FilmStripeConfig` the `GameConfig` union
- New routes (documented in `specs/api/openapi.yaml`):
  - `GET /api/film-stripe/frame?path=<rel>&i=<n>` — show zone, one still from the cache, 404 when not computed
  - `GET /api/backend/assets/videos/film-stripe/status?paths=a|b` — admin zone
  - `POST /api/backend/assets/videos/film-stripe/prepare` — admin zone, body `{ paths, force? }`, SSE progress
- New background-task type `film-stripe`; its `meta.filmStripe` is `{ paths, done, failed: [{ path, error }], current?, currentPercent? }`. Films run in `paths` order, so the first `done` of them are finished
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
- Cancelling a running build
- Filling `answerImage` with the poster automatically
