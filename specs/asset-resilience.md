# Spec: Asset Resilience for Audio + Image Games

## Goal

During a live gameshow, transient network failures must not silently break a question's audio and answer image. The frontend retries failed loads automatically and exposes a "Asset neu laden" button on the gamemaster screen when retries exhaust, so the show can recover without a full page reload.

## Acceptance criteria

- [x] Every `HTMLMediaElement.play()` call in `SimpleQuiz`, `AudioGuess`, `Bandle`, and `VideoGuess` goes through a shared `safePlay()` helper that retries once after a 200ms backoff and skips retry on `AbortError`.
- [x] Every freshly-set audio source is watched for slow loads. If `canplay` / `loadedmetadata` / `error` hasn't fired within `MEDIA_SLOW_LOAD_MS` (10s), the question is flagged `assetFailed` and the retry button surfaces. Without this, a hanging server fetch leaves the projector blank for minutes with no recovery UI.
- [x] `<RetryImage>` has the same slow-load watchdog (`IMAGE_SLOW_LOAD_MS`, 8s). A stalled image counts as an error and triggers the existing retry-with-cache-bust path.
- [x] `usePreloadAsset` warms the HTTP cache via `fetch()`, NOT `new Image()` / `new Audio()`. An `<audio preload="auto">` keeps its HTTP/1.1 keep-alive connection open while it buffers; across question advances those leaked connections accumulated and saturated Firefox's per-origin limit (6), queueing every subsequent audio request for minutes (the projector would sit silent on a question with the server idle). `fetch()` releases the connection as soon as the body is drained, and the main game's `<audio>` / `<img>` for the same URL hits the warm HTTP cache (server already sets `Cache-Control: public, max-age=300`). The fetch is intentionally NOT given an `AbortSignal` — Firefox coalesces preload + main-game fetch for the same URL, and aborting on cleanup would also abort the main game's request.
- [x] Every game-answer `<img>` in `QuizQuestionView`, `AudioGuess`, `Bandle`, and `VideoGuess` renders via a `<RetryImage>` component that auto-retries up to 2 times with a cache-busting `?v={attempt}` query string applied only on retry — never on the initial render (so back-navigation still hits the HTTP cache).
- [x] When a question's image or audio fails after all auto-retries, the gamemaster screen surfaces an "Asset neu laden" button. The button is hidden when no failure has been detected for the current question.
- [x] Pressing the gamemaster button re-runs the asset fetch and re-triggers autoplay for the current question.
- [x] When no gamemaster PWA is connected, the show frontend renders an inline "Asset neu laden" button instead (same recovery action). The button is hidden once any GM connects.
- [x] When the user advances to question N, the assets for question N+1 are prefetched in the background (`new Image()` for images, `new Audio()` with `preload='auto'` for audio). The preload runs once at mount and once more on answer reveal if the first attempt failed.
- [x] Every transient failure logs a `console.warn('[asset-resilience] ...', { game, qIdx, asset, error })` line for post-show diagnostics.
- [x] When a question changes, the previous question's `HTMLAudioElement` has its `src` cleared (`audio.src = ''; audio.load()`) and its event listeners removed, freeing the browser's media decoder.
- [x] `SimpleQuiz`'s `skipAudioCleanupRef` no longer leaks `true` across question changes — it is reset at the start of every qIdx effect run.
- [x] `SimpleQuiz.handleBack`'s manually-created `Audio` element removes its event listeners on cleanup.
- [x] `AudioGuess` no longer relies on the fragile `<audio><source src={...} /></audio>` + `audio.load()` pattern; it sets `audio.src = q.audio` imperatively, matching the existing Bandle pattern.
- [x] All existing tests for `SimpleQuiz`, `AudioGuess`, `Bandle` still pass. New tests cover: retry on `play()` rejection, retry on `<img>` error, gamemaster button surfacing after exhausted retries, preload of N+1.

## State / data changes

No `AppState` changes. No localStorage changes. No new API endpoints.

**WebSocket additions** (documented in [specs/api/asyncapi.yaml](api/asyncapi.yaml) + [specs/api/inventory.md](api/inventory.md)):
- New meta message `{ type: 'gm-register' }` sent by every gamemaster PWA on connect.
- New cached channel `gm-presence` carrying `{ connected: boolean }`. Server broadcasts on every 0↔1+ transition of the GM-client set.

Per-game inner-component state additions:
- `assetFailed: boolean` — true once any auto-retry has exhausted for the current question. Reset on qIdx change.
- `reloadKey: number` — bumped when the gamemaster presses "Asset neu laden"; used as a remount key for `<RetryImage>` and as an effect dependency for re-triggering autoplay.

New `GamemasterControl` button id: `'asset-reload'`. Handled per-game in each `commandHandlerFn`.

## UI behaviour

**Show screen (projector):** no visible change in the happy path. When an asset fails:
- `<RetryImage>` shows a small inline placeholder while retrying (`alt=""` placeholder, no error icon shown to the audience — failures are recoverable and we don't want to draw the audience's eye to a problem the gamemaster is about to fix).
- After all retries fail, the placeholder stays. No audience-facing error banner.
- **If no gamemaster PWA is currently connected**, an inline `<AssetReloadButton>` appears below the question/answer with the label "Asset neu laden". Pressing it has the same effect as the gamemaster button. This lets the show recover when run standalone (no separate GM device). The button is hidden the moment any GM connects.

**Gamemaster screen:** when `assetFailed === true` for the current question, the existing controls list grows by one button: "Asset neu laden". Pressing it re-runs the asset fetch and re-triggers autoplay. Button disappears on next question or on successful retry.

**GM presence detection:** the server tracks `gm-register` meta messages from every GM PWA on connect and broadcasts `gm-presence: { connected: boolean }` whenever the GM-client set transitions between 0 and 1+. The show uses `useGmConnected()` to subscribe; the inline button only appears when `connected === false`.

**Theme Showcase:** `<RetryImage>` is added to `FrontendShowcase` with two visible states — happy path and final-failure placeholder — so theme authors can style it across themes.

## Components / files affected

**New:**
- `src/utils/safePlay.ts` — shared media-play helper. Extracted/generalized from the existing inline `safePlay` in [VideoGuess.tsx:163-183](../src/components/games/VideoGuess.tsx#L163-L183).
- `src/utils/mediaLoadTimeout.ts` — `watchMediaLoad(media, timeoutMs, onSlow)` + `MEDIA_SLOW_LOAD_MS` / `IMAGE_SLOW_LOAD_MS` constants. Watches an audio/video element for the first `canplay` / `loadedmetadata` / `error` signal; calls `onSlow()` if none fires within the timeout.
- `src/hooks/usePreloadAsset.ts` — eager prefetch hook for `{ image?: string; audio?: string }`. Uses `fetch()` to warm the HTTP cache (no MediaElement, no held keep-alive). Fetch runs without an `AbortSignal` so Firefox's coalesced preload + main-game fetch never aborts.
- `src/hooks/useGmConnected.ts` — tracks whether any gamemaster PWA is registered (via the `gm-presence` WS channel).
- `src/components/common/RetryImage.tsx` — `<img>` wrapper with retry + cache-bust + `onFinalFailure` callback + slow-load timeout.
- `src/components/common/AssetReloadButton.tsx` — inline frontend recovery button shown when `assetFailed && !gmConnected`.

**Modified:**
- `src/components/games/SimpleQuiz.tsx`, `AudioGuess.tsx`, `Bandle.tsx`, `VideoGuess.tsx`, `QuizQuestionView.tsx`
- `src/components/screens/ThemeShowcase.tsx` (new `<RetryImage>` example)
- Tests for each game component

## Out of scope

- **Image guess** game (`ImageGuess.tsx`) — its `useImageLoader` hook serves a different purpose (returns the decoded `HTMLImageElement` for canvas drawing). Not touching it; it is intentionally different. The latent fetch-abort issue at [ImageGuess.tsx:74](../src/components/games/ImageGuess.tsx#L74) is documented but not fixed here.
- Server-side asset fallback (e.g., NAS-mirror retry, alternative codecs) — handled separately by the existing local-first / NAS-sync pipeline.
- Service-worker offline support — sw.js is intentionally minimal ([src/sw.js](../src/sw.js)) for streaming-friendliness; we don't add fetch interception.
- Pre-game asset health-check / dashboard — not in scope here. Adding the `console.warn` log lines gives a post-show diagnostic surface; a real telemetry pipeline is a follow-up if needed.
- Audience-facing error UI — failures are surfaced only to the gamemaster.
