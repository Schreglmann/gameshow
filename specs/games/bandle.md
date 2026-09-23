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
- [ ] Advancing to the hint or answer stage switches to the last track if a non-final track is currently loaded; if the last track is already loaded but paused, it resumes; if the last track is already playing it is left alone (no restart from 0). Applies both to host advancement (right arrow) and to "Auflösen". Audio controls remain visible during the hint stage
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
- [ ] Holding the forward key (ArrowRight **or** Space) during gameplay jumps directly to the answer (for presenter-only mode). The hold is detected via OS key-repeat or a ≥500 ms timer, whichever comes first (robust against presenter clickers that send an early keyup); uses the shared [`useArrowRightLongPress`](../../src/hooks/useArrowRightLongPress.ts) hook (same as `ranking` / `four-statements`)
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

## Admin: catalog song-picker (`BandleForm` → `BandleSongPicker`)
- The "+ Song aus Katalog hinzufügen" button opens a modal listing the bandle catalog, filtered by: free-text search, **Schwierigkeit** (par), **Jahrzehnt** (decade), and **Pack**
- All four filters are **multi-select**: Schwierigkeit/Jahrzehnt/Pack are toggle chips (a value is included when *any* selected chip matches; packs OR together). The Pack group has many options so it is capped at ~3 rows and scrolls internally
- **Verwendung filter**: a single toggle chip "Bereits verwendete Songs ausblenden" (**active by default**) hides songs already used in *any* bandle game (every game file of type `bandle`, base questions + all instances). The used set comes from `GET /api/backend/bandle/used-songs`, re-fetched on every picker open so edits to other games are reflected
- **Song identity is the audio folder slug** (`songSlug(entry.song)`, the `/audio/bandle/<slug>/` segment of a question's track paths) — questions do not carry the catalog's hex `path`. Both the unconditional "already in this instance" dedupe and the Verwendung filter compare slugs
- **Songs are multi-selected via checkboxes**: clicking a row toggles a checkmark; a footer button (`N Song(s) hinzufügen`, disabled when nothing is checked) appends **all** checked songs to the instance at once (in the order they were checked) and then closes the modal. Selection survives filter changes within the open picker (so you can filter → check → re-filter → check more, then add together), but is **local to the picker** — cleared on add and when the picker is closed/discarded
- **Sortierung**: a single-select chip row below the filters, with four fields — **Name** (`song`), **Klicks** (`view`), **Hinzugefügt** (when bandle added the song), **Erscheinungsjahr** (`year`). The picker **opens unsorted**, in the order the catalog endpoint returns, with no chip active. Clicking a chip runs a **three-step cycle** (`nextSort`): pick the field at its default direction → flip the direction → back to unsorted. Clicking a different field switches to it at that field's default direction — `Name` starts A→Z, the three numeric fields start descending (most clicks / most recently added / newest release first). The active chip carries a `↓`/`↑` arrow, and its `title` names what the next click does. `sortCatalog(entries, null)` returns the input array untouched. Sorting runs after filtering (`sortCatalog`), ties break on the song title so equal keys keep a stable order, and entries missing the key sort last in both directions
- **Hinzugefügt** combines two sources, finest first:
  - `dailyDate` — the **exact date** the song ran as bandle's daily puzzle, from `/v2/planning/<YYYY-MM-DD>.txt`. That endpoint is how the bandle app itself picks each day's song, and it is the only place a *day* is recorded. Bandle serves it for **only the last few days**, so a day is available for songs added while syncing regularly, never retroactively — most of the catalog stays month-only
  - `folder` — bandle's own slot for the song, verbatim from the pack listing. Two forms: `"202607/Wanted"` (the year+month it ran) and `"_kpop/Yeobo"` for songs that only belong to a themed pack and never had a daily slot. `addedMonth()` parses the leading `YYYYMM`
  `addedDay()` accepts `dailyDate` **only when it falls inside the `folder` month**. Bandle re-runs old songs, so a planning hit can be a repeat airing years after the song was added — The Fray's "How to Save a Life" sits in `202408` yet aired again on 2026-08-18 — and treating that as the added date would float an old song to the top of the list. A date outside the month is dropped and the song keeps its correct month-only position. `addedKey()` then builds a `YYYYMMDD` key: the exact day when known, else the month at day `00`, so a month-only song sorts just ahead of that month's dated songs. Songs with neither (themed-pack only) yield `null` and sort last in both directions. There is **no running id** — `path` is an opaque 20-char hex key
- Dated rows show a `MM/YYYY` badge next to the view count. Its hover title (`addedTitle`) gives the exact date when known — `Bei Bandle hinzugefügt: 15. Juli 2026` — and otherwise names the month and says `(Tag unbekannt)` rather than implying a day that was never recorded
- `scripts/bandle-sync.cjs` stores `folder` on newly synced songs and, on every run, **backfills it into existing `metadata.json` files** from the pack listing it already fetches for all songs — so a song written before the field was tracked is repaired by the next sync without re-downloading audio. File mtimes are useless as an added-date signal: a sync run rewrites every metadata file it touches
- The sync **reuses the stored browser session**: `openAuthenticatedSession()` first launches the persistent profile **headless** and gives Firebase `SESSION_PROBE_MS` (20s) to restore a token, so a normal run opens no window at all. A visible window appears only when that turns up no valid token — or when the headless launch itself fails (no headless-shell binary, locked profile), which falls through to the same login flow rather than aborting. The probe context is closed before the visible one opens, since a profile directory only takes one context
- The same run walks the **daily planning**: `pendingPlanningDates()` lists the days in the last `PLANNING_LOOKBACK_DAYS` (14) that the `local-assets/audio/bandle/.planning-dates.json` sidecar has no answer for, fetches `/v2/planning/<date>.txt` for each, and records `date → song path`. A day that resolves to no song is cached as `null` so it is not retried; a *failed* fetch records nothing and is retried next run. `earliestDateByPath()` inverts the sidecar keeping the **first** airing, and `applyDailyDates()` stamps `dailyDate` onto the catalog. **The window is deliberate**: bandle only publishes planning for roughly the last three days — a measured 1449-day sweep resolved exactly the newest three — so walking the archive costs ~1450 futile requests per run and recovers nothing. 14 days leaves slack for a sync that skips a week
- Filter and sort state are **lifted into `BandleForm`** (not `BandleSongPicker`, which is unmounted on every add) so they **persist across closing and reopening** the picker within the same editing session. They are plain component state — they **reset on a full page reload** (when `BandleForm` unmounts), by design

## Out of scope
- Web Audio API / layered stem playback (using pre-mixed tracks instead)
- Per-question scoring (handled by `AwardPoints` after the game)
- Automatic song recognition / guessing input
