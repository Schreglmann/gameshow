# API Contract Inventory

> **Purpose.** Single human-readable index of every HTTP route and WebSocket channel the gameshow backend exposes. Source of truth for [openapi.yaml](openapi.yaml) and [asyncapi.yaml](asyncapi.yaml). If a route or channel is not in this file, it does not exist.
>
> **How to read the Zone column.** Which PWA(s) are the legitimate callers / subscribers of this contract:
> - `frontend` — the player-facing show PWA (`/show/`).
> - `admin` — the CMS PWA (`/admin/`).
> - `gamemaster` — the live-control PWA (`/gamemaster/`).
> - `shared` — called by two or more zones.
> - `internal` — not called by any PWA directly (static file serving, SPA fallback, legacy endpoints).

Source files (line numbers link to the declaration):

- REST: [server/index.ts](../../server/index.ts)
- WebSocket: [server/ws.ts](../../server/ws.ts)
- Client usage (zone attribution derived from):
  - [src/services/api.ts](../../src/services/api.ts) — show PWA + gamemaster PWA public API
  - [src/services/backendApi.ts](../../src/services/backendApi.ts) — admin PWA backend API
  - [src/services/useBackendSocket.ts](../../src/services/useBackendSocket.ts) — WS client abstraction
  - [src/hooks/useGamemasterSync.ts](../../src/hooks/useGamemasterSync.ts) — gamemaster state sync
  - [src/hooks/useShowPresence.ts](../../src/hooks/useShowPresence.ts) — show-presence / active-show protocol

---

## 1. REST endpoints

### 1.1 Static / infrastructure (internal)

| Method | Path | Line | Purpose | Notes |
|--------|------|------|---------|-------|
| `GET` | `/` | [1441](../../server/index.ts#L1441) | Dev redirect to `/show/`. Also 404s unknown paths in dev. | Dev only. |
| `GET` | `/local-assets/images/**`, `/audio/**`, `/videos/**`, `/background-music/**`, `/bandle-audio/**` | [1493](../../server/index.ts#L1493) | Serves raw asset files. | `express.static`. |
| `GET` | `/videos-compressed/:start/:end/*splat` | [1776](../../server/index.ts#L1776) | Serves pre-transcoded H.264 SDR video segment for a given range. | Range-GET; used by `<video>` tags in `simple-quiz`/`video-guess`/etc. |
| `GET` | `/videos-sdr/:start/:end/*splat` | [1854](../../server/index.ts#L1854) | Serves pre-transcoded HDR→SDR tone-mapped video segment. | Range-GET; video-guess + any HDR source. |
| `GET` | `/*splat` | [5434](../../server/index.ts#L5434) | SPA fallback — returns `index.html` for any path not matched above. | Prod only. Mirrors `/show/`, `/admin/`, `/gamemaster/`. |

### 1.2 Frontend / shared public API (consumed by show + gamemaster PWAs)

| Method | Path | Zone | Line | Purpose | Request shape | Response shape |
|--------|------|------|------|---------|---------------|----------------|
| `GET` | `/api/background-music` | `frontend` | [2059](../../server/index.ts#L2059) | List `.mp3` filenames in `local-assets/background-music/`. Optional `?theme=` filters to a theme subfolder. | Query: `theme?: string` | `string[]` (bare array of filenames) |
| `GET` | `/api/settings` | `shared` | [2073](../../server/index.ts#L2073) | Returns active gameshow's global settings (active key, team sizes, point system, teamRandomizationEnabled, joker config, activeGameshowTitle, isCleanInstall, gameCount). | — | `SettingsResponse` |
| `GET` | `/api/theme` | `shared` | [2124](../../server/index.ts#L2124) | Current theme selection for frontend and admin PWAs. | — | `{ frontend: string; admin: string }` |
| `PUT` | `/api/theme` | `shared` | [2128](../../server/index.ts#L2128) | Update one or both theme names. Persisted to `theme-settings.json`. | Body: `Partial<{ frontend: string; admin: string }>` | `{ frontend: string; admin: string }` |
| `GET` | `/api/video-hdr` | `frontend` | [2145](../../server/index.ts#L2145) | Probe an asset path and return whether the video is HDR. Used by the player to choose between `/videos-compressed` and `/videos-sdr`. | Query: `path: string` (asset-relative) | `{ isHdr: boolean }` |
| `GET` | `/api/game/:index` | `shared` | [2178](../../server/index.ts#L2178) | Loaded game data for slot `index` in the active gameshow's `gameOrder`. The server resolves `gameOrder[index]` → `games/<name>.json` and returns a type-tagged union. | Path: `index: number` | `GameDataResponse` |

### 1.3 Admin backend — games CRUD

| Method | Path | Zone | Line | Purpose | Request shape | Response shape |
|--------|------|------|------|---------|---------------|----------------|
| `GET` | `/api/backend/games` | `admin` | [2219](../../server/index.ts#L2219) | List every game file with metadata (file, type, title, instances[], whether it's a template). | — | `{ games: GameFileSummary[] }` |
| `GET` | `/api/backend/games/:fileName` | `admin` | [2269](../../server/index.ts#L2269) | Read a single game file verbatim. | Path: `fileName: string` | Raw game JSON (`GameConfig` or `MultiInstanceGameFile`) |
| `PUT` | `/api/backend/games/:fileName` | `admin` | [2281](../../server/index.ts#L2281) | Write a game file atomically (tmp+rename). Validates against game-type schemas. | Path: `fileName`. Body: raw game JSON. | `{ ok: true }` or `{ error: string }` |
| `POST` | `/api/backend/games/:fileName/instances/:instance/unlock-precheck` | `admin` | [2381](../../server/index.ts#L2381) | Pre-flight for video-guess instance-lock: lists missing segment caches and offline references that would break the game. | Path: `fileName`, `instance` | `{ missing: string[]; offlineReferences: string[] }` |
| `POST` | `/api/backend/games` | `admin` | [2427](../../server/index.ts#L2427) | Create a new game file. | Body: `{ fileName: string; gameFile: unknown }` | `{ ok: true }` |
| `POST` | `/api/backend/games/:fileName/rename` | `admin` | [2441](../../server/index.ts#L2441) | Rename a game file. Rewrites `gameOrder` references in `config.json`. | Path: `fileName`. Body: `{ newFileName: string }` | `{ newFileName: string }` |
| `DELETE` | `/api/backend/games/:fileName` | `admin` | [2489](../../server/index.ts#L2489) | Delete a game file. Rejects if still referenced in `gameOrder`. | Path: `fileName` | `{ ok: true }` or `{ error: string }` |

### 1.4 Admin backend — config

| Method | Path | Zone | Line | Purpose | Request shape | Response shape |
|--------|------|------|------|---------|---------------|----------------|
| `GET` | `/api/backend/config` | `admin` | [2563](../../server/index.ts#L2563) | Full `config.json` including active gameshow key, gameshows map, global rules, joker catalog enablement. | — | `AppConfig` |
| `PUT` | `/api/backend/config` | `admin` | [2573](../../server/index.ts#L2573) | Atomic write of `config.json`. Validates structure; rejects old `{ games: ... }` shape. | Body: `AppConfig` | `{ ok: true }` or `{ error: string }` |

### 1.5 Admin backend — bandle (audio-guess helper)

| Method | Path | Zone | Line | Purpose | Request shape | Response shape |
|--------|------|------|------|---------|---------------|----------------|
| `GET` | `/api/backend/bandle/catalog` | `admin` | [2502](../../server/index.ts#L2502) | List Bandle tracks with artist/title/preview URLs — used by `bandle` game editor. | — | `BandleCatalogEntry[]` |
| `POST` | `/api/backend/bandle/download-audio` | `admin` | [2521](../../server/index.ts#L2521) | Queue background download of Bandle preview audio into `local-assets/bandle-audio/`. | Body: `{ bandlePath: string; ... }` | `{ ok: true; jobId?: string }` |
| `GET` | `/api/backend/bandle/available-audio` | `admin` | [2537](../../server/index.ts#L2537) | List already-downloaded Bandle audio files. | — | `string[]` |
| `GET` | `/api/backend/bandle/audio-status/:bandlePath` | `admin` | [2548](../../server/index.ts#L2548) | Per-track download status. | Path: `bandlePath` | `{ status: 'missing' \| 'downloading' \| 'ready'; percent?: number }` |

### 1.6 Admin backend — assets / DAM

All asset mutations broadcast `assets-changed` on the WebSocket. All writes are atomic (`.tmp` + rename). Delete is soft (moves to `.trash/<batchId>/`).

| Method | Path | Zone | Line | Purpose | Request shape | Response shape |
|--------|------|------|------|---------|---------------|----------------|
| `GET` | `/api/backend/assets/:category` | `admin` | [3078](../../server/index.ts#L3078) | List one category (`images` / `audio` / `videos` / `background-music` / `bandle-audio`). Recursive, includes subfolders. | Path: `category`. Query: `subfolder?` | `AssetListResponse` |
| `POST` | `/api/backend/assets/:category/upload` | `admin` | [3138](../../server/index.ts#L3138) | Multipart single-file upload. Used for files ≤ 10 MB. | Path: `category`. Query: `subfolder?`. Multipart field `file`. | `{ fileName: string }` |
| `POST` | `/api/backend/assets/:category/upload-chunk` | `admin` | [3337](../../server/index.ts#L3337) | Multipart chunk of a large file. | Path: `category`. Query: `uploadId`, `chunkIndex`, `totalChunks`, `fileName`, `subfolder?`. Multipart field `chunk`. | `{ ok: true }` |
| `POST` | `/api/backend/assets/:category/upload-finalize` | `admin` | [3365](../../server/index.ts#L3365) | Assemble uploaded chunks into the final file. | Body: `{ uploadId; fileName; totalChunks; subfolder? }` | `{ fileName: string }` |
| `POST` | `/api/backend/assets/:category/upload-abort` | `admin` | [3446](../../server/index.ts#L3446) | Clean up an aborted chunked upload. | Body: `{ uploadId: string }` | `{ ok: true }` |
| `POST` | `/api/backend/assets/:category/download-url` | `admin` | [3223](../../server/index.ts#L3223) | Download an image from an arbitrary URL into the DAM. | Body: `{ url: string; subfolder?: string }` | `{ fileName: string }` |
| `POST` | `/api/backend/assets/:category/move` | `admin` | [2660](../../server/index.ts#L2660) | Move or rename an asset. Rewrites references in every `games/*.json`. Supports cross-category moves (e.g. audio ↔ background-music). | Body: `{ from: string; to: string; toCategory?: AssetCategory }` | `{ ok: true; rewrittenGames: number }` |
| `POST` | `/api/backend/assets/:category/merge` | `admin` | [2779](../../server/index.ts#L2779) | Merge two duplicate assets. Keeps one, rewrites game references from the discarded one, optionally cascades movie-poster cover merges. | Body: `{ keep: string; discard: string }` | `MergeAssetResult` |
| `POST` | `/api/backend/assets/:category/mkdir` | `admin` | [5210](../../server/index.ts#L5210) | Create a subfolder under a category. | Body: `{ folderPath: string }` | `{ ok: true }` |
| `DELETE` | `/api/backend/assets/:category/*splat` | `admin` | [5235](../../server/index.ts#L5235) | Soft-delete (move to `.trash/<batchId>/`). Multiple calls with the same `?batchId=` group into one undoable batch. | Path: `category`, rest path. Query: `batchId?` | `{ ok: true }` |
| `POST` | `/api/backend/assets/undo-delete` | `admin` | [5324](../../server/index.ts#L5324) | Restore the most recent batch from `.trash/`. | — | `UndoDeleteResult` |
| `GET` | `/api/backend/asset-usages` | `admin` | [2619](../../server/index.ts#L2619) | Find which games reference a specific asset file. | Query: `category`, `file` | `{ games: Array<{ fileName, title, instance?, markers?, questionIndices? }> }` |

### 1.7 Admin backend — video tooling

| Method | Path | Zone | Line | Purpose | Request shape | Response shape |
|--------|------|------|------|---------|---------------|----------------|
| `GET` | `/api/backend/assets/videos/probe` | `admin` | [4195](../../server/index.ts#L4195) | ffprobe a video: tracks, stream info, HDR, faststart, needsTranscode. Cached persistently. | Query: `path: string` | `VideoProbeResult` |
| `GET` | `/api/backend/assets/videos/reference-roots` | `admin` | [4218](../../server/index.ts#L4218) | List user-filesystem root directories suitable for browsing reference videos. OS-aware. | — | `{ roots: ReferenceRoot[] }` |
| `GET` | `/api/backend/assets/videos/reference-browse` | `admin` | [4229](../../server/index.ts#L4229) | Browse a directory on the user's filesystem for video files. | Query: `path: string` | `ReferenceBrowseResponse` |
| `POST` | `/api/backend/assets/videos/add-reference` | `admin` | [4271](../../server/index.ts#L4271) | Add a symlink to an external video file into the DAM. | Body: `{ sourcePath; subfolder?; name? }` | `{ fileName: string; relPath: string }` |
| `POST` | `/api/backend/assets/videos/fetch-cover` | `admin` | [4170](../../server/index.ts#L4170) | Auto-fetch a movie poster for a video based on filename. | Body: `{ fileName: string }` | `{ posterPath: string \| null; logs: string[] }` |
| `POST` | `/api/backend/assets/videos/faststart` | `admin` | [4442](../../server/index.ts#L4442) | Rewrite a video with faststart `moov` atom at the start for seekability. | Body: `{ filePath: string }` | JSON `{ alreadyFaststart: true }` OR SSE stream of `FaststartEvent` |
| `GET` | `/api/backend/assets/videos/faststart-status` | `admin` | [4490](../../server/index.ts#L4490) | Peek at in-flight faststart progress. | Query: `path: string` | `{ running: boolean; percent: number \| null }` |
| `GET` | `/api/backend/assets/videos/cached-tracks` | `admin` | [4863](../../server/index.ts#L4863) | Which track variants have cache files on disk for a video range. | Query: `video`, `start`, `end` | `CachedTracks` |
| `GET` | `/api/backend/assets/videos/sdr-cache-status` | `admin` | [4844](../../server/index.ts#L4844) | Whether an HDR→SDR cache file exists for a video/range/track. | Query: `video`, `start`, `end`, `track?` | `{ cached: boolean }` |
| `GET` | `/api/backend/assets/videos/cache-check` | `admin` | [4899](../../server/index.ts#L4899) | Aggregate cache-readiness probe for a list of video-guess segments. | Query: per-video list | `{ missing: Array<...>; total: number }` |
| `POST` | `/api/backend/assets/videos/warmup-sdr` | `admin` | [4989](../../server/index.ts#L4989) | Pre-transcode an HDR→SDR segment. | Body: `{ video; start; end; track? }` | JSON `{ cached: true }` OR SSE stream of `WarmupSdrEvent` |
| `POST` | `/api/backend/assets/videos/warmup-compressed` | `admin` | [4993](../../server/index.ts#L4993) | Pre-transcode an H.264 compressed segment (max 1080p). | Body: `{ video; start; end; track? }` | JSON `{ cached: true }` OR SSE stream of `WarmupSdrEvent` |
| `GET` | `/api/backend/assets/videos/warm-preview` | `admin` | [4563](../../server/index.ts#L4563) | Preview which videos the active gameshow would warm, with HDR-probe flags. | — | `{ videos: WarmPreviewVideo[] }` |
| `POST` | `/api/backend/assets/videos/warm-all` | `admin` | [4587](../../server/index.ts#L4587) | Queue warmup for every selected video. | Body: `{ selected?: Array<{ path; hdrProbe }> }` | `{ queued: number }` |

### 1.8 Admin backend — cache management

| Method | Path | Zone | Line | Purpose | Request shape | Response shape |
|--------|------|------|------|---------|---------------|----------------|
| `GET` | `/api/backend/cache-status` | `admin` | [5080](../../server/index.ts#L5080) | Missing segment caches for a gameshow (drives the landing-screen warning banner). | Query: `gameshow?`, `allLanguages?` | `{ gameshow; total; missing: MissingCacheEntry[] }` |
| `POST` | `/api/backend/cache-warm-all` | `admin` | [5109](../../server/index.ts#L5109) | Warm every missing cache. SSE stream of progress. | Query: `gameshow?`, `allLanguages?` | SSE stream of `WarmAllEvent` |
| `POST` | `/api/backend/cache-warm-all/cancel` | `admin` | [5200](../../server/index.ts#L5200) | Cancel the in-flight cache-warm run. | — | `{ cancelled: boolean }` |
| `POST` | `/api/backend/caches/clear` | `admin` | [2923](../../server/index.ts#L2923) | Wipe SDR + compressed + HDR caches. Broadcasts `caches-cleared`. | — | `{ cleared: { sdr: number; compressed: number; hdr: number } }` |

### 1.9 Admin backend — YouTube download

| Method | Path | Zone | Line | Purpose | Request shape | Response shape |
|--------|------|------|------|---------|---------------|----------------|
| `POST` | `/api/backend/assets/:category/youtube-download` | `admin` | [3608](../../server/index.ts#L3608) | Download a YouTube audio or video URL (or playlist) into the DAM. SSE stream of progress. | Body: `{ url; subfolder?; playlist? }` | SSE stream of `YouTubeDownloadEvent` |
| `POST` | `/api/backend/yt-download-cancel/:jobId` | `admin` | [3599](../../server/index.ts#L3599) | Cancel an in-flight YouTube download. | Path: `jobId` | `{ ok: true }` |

### 1.10 Admin backend — audio-cover auto-fetch

| Method | Path | Zone | Line | Purpose | Request shape | Response shape |
|--------|------|------|------|---------|---------------|----------------|
| `GET` | `/api/backend/audio-covers/list` | `admin` | [4653](../../server/index.ts#L4653) | List covers already fetched and stored. | — | `{ covers: string[] }` |
| `POST` | `/api/backend/audio-cover-fetch` | `admin` | [4704](../../server/index.ts#L4704) | Batch-fetch covers for audio files by artist/title lookup. SSE stream. | Body: `{ files: string[] }` | SSE stream of `AudioCoverEvent` |
| `POST` | `/api/backend/audio-cover-cancel/:jobId` | `admin` | [4670](../../server/index.ts#L4670) | Cancel a running audio-cover fetch job. | Path: `jobId` | `{ ok: true }` |
| `POST` | `/api/backend/audio-cover-confirm/:jobId/:fileIndex` | `admin` | [4693](../../server/index.ts#L4693) | Accept or reject a found cover (confirm phase). | Path: `jobId`, `fileIndex`. Body: `{ accept: boolean }` | `{ ok: true }` |
| `DELETE` | `/api/backend/audio-cover-job/:jobId` | `admin` | [4686](../../server/index.ts#L4686) | Dismiss a done / errored job from the list. | Path: `jobId` | `{ ok: true }` |
| `GET` | `/api/backend/audio-cover/meta` | `admin` | [server/index.ts](../../server/index.ts) | Per-cover provenance map (backs the source pill). See [specs/audio-cover-override.md](../audio-cover-override.md). | — | `{ meta: Record<string, AudioCoverMetaEntry> }` |
| `POST` | `/api/backend/audio-cover/override` | `admin` | [server/index.ts](../../server/index.ts) | Replace an audio's cover with an image from the DAM. | Body: `{ audioFileName, sourceImagePath }` | `{ success: true, coverPath, version }` |
| `POST` | `/api/backend/audio-cover/itunes` | `admin` | [server/index.ts](../../server/index.ts) | Fetch an iTunes cover and overwrite the canonical cover. Unconfident matches return a `confirmToken` for a second-call confirmation. | Body: `{ audioFileName, confirmToken? }` | `{ success, coverPath, version, source }` or `{ confirmRequired, confirmToken, candidate }` |

### 1.11 Admin backend — system status & stream notify

| Method | Path | Zone | Line | Purpose | Request shape | Response shape |
|--------|------|------|------|---------|---------------|----------------|
| `GET` | `/api/backend/system-status` | `admin` | [3068](../../server/index.ts#L3068) | One-shot read of the aggregated system-status payload. Same shape as the `system-status` WS push. | — | `SystemStatusResponse` |
| `POST` | `/api/backend/stream-notify` | `frontend` | [2954](../../server/index.ts#L2954) | Frontend signals to the server that a video/audio stream is active so NAS background sync and chunked uploads throttle themselves. Called from [Lightbox.tsx](../../src/components/layout/Lightbox.tsx), [VideoGuess.tsx](../../src/components/games/VideoGuess.tsx), and [useVideoPlayback.ts](../../src/services/useVideoPlayback.ts). Path prefix `/api/backend/` is historical — the caller is frontend, not admin. | Body: `{ active: boolean }` | `{ ok: true }` |

### 1.12 Admin backend — Whisper transcription

| Method | Path | Zone | Line | Purpose | Request shape | Response shape |
|--------|------|------|------|---------|---------------|----------------|
| `GET` | `/api/backend/assets/videos/whisper/health` | `admin` | [5381](../../server/index.ts#L5381) | Is whisper.cpp installed and the model present. | — | `WhisperHealth` |
| `GET` | `/api/backend/assets/videos/whisper/jobs` | `admin` | [5385](../../server/index.ts#L5385) | All Whisper jobs across the DAM. | — | `{ jobs: WhisperJob[] }` |
| `GET` | `/api/backend/assets/videos/whisper/status` | `admin` | [5389](../../server/index.ts#L5389) | Single-job status for a given video. | Query: `path: string` | `{ job: WhisperJob \| null }` |
| `GET` | `/api/backend/assets/videos/whisper/transcript` | `admin` | [5395](../../server/index.ts#L5395) | Fetch the completed transcript text. | Query: `path: string` | `string` (plain text) or `{ error }` |
| `POST` | `/api/backend/assets/videos/whisper/start` | `admin` | [5403](../../server/index.ts#L5403) | Start transcription for one video. | Body: `{ path: string; language: 'en' \| 'de' }` | `{ job: WhisperJob }` |
| `POST` | `/api/backend/assets/videos/whisper/pause` | `admin` | [5419](../../server/index.ts#L5419) | Pause (SIGSTOP). | Body: `{ path: string }` | `{ job: WhisperJob }` |
| `POST` | `/api/backend/assets/videos/whisper/resume` | `admin` | [5419](../../server/index.ts#L5419) | Resume (SIGCONT). | Body: `{ path: string }` | `{ job: WhisperJob }` |
| `POST` | `/api/backend/assets/videos/whisper/stop` | `admin` | [5419](../../server/index.ts#L5419) | Stop and delete the job. | Body: `{ path: string }` | `{ job: WhisperJob }` |

**Endpoint total:** 5 infrastructure + 6 frontend/shared + 46 admin = **57 documented** routes. (The plan text estimated ~68; exploration double-counted a few SSE alternates and static mounts. The actual route-declaration grep line-count is the authoritative number.)

---

## 2. WebSocket channels (`/api/ws`)

All channels multiplex on a single WebSocket endpoint. The wire format is `{ channel: WsChannel; data: unknown }` for payload messages and `{ type: 'show-register' | 'show-claim' }` for meta control messages.

**Direction legend:** `S→C` = server pushes to all clients. `C→S→C` = client emits, server re-broadcasts to all OTHER clients (skipping the origin). `C→S` = client-only meta message handled by the server.

**Cached?** `yes` = server holds the last value and sends it to any newly connected client in the initial-state burst.

| Channel | Direction | Cached? | Emitter(s) | Zone | Purpose |
|---------|-----------|---------|------------|------|---------|
| `system-status` | S→C (periodic 2s) | no | [server/index.ts:522](../../server/index.ts#L522) | `admin` | Server metrics, processes, caches, NAS sync status. Payload shape: `SystemStatusResponse`. |
| `asset-storage` | S→C (periodic 5s) | no | [server/ws.ts:138](../../server/ws.ts#L138) | `admin` | Storage mode + NAS mount reachable flag. |
| `asset-duration` | S→C (batch) | no | [server/index.ts:747](../../server/index.ts#L747) | `admin` | `{ category; durations: Record<fileName, seconds> }`. Pushed while the admin enumerates a category. |
| `assets-changed` | S→C | no | [server/index.ts:870](../../server/index.ts#L870) | `admin` | Any DAM mutation. Payload: `{ category: AssetCategory }`. Clients invalidate their asset list cache. |
| `yt-download-status` | S→C | no | [server/index.ts:3628](../../server/index.ts#L3628) | `admin` | `{ jobs: YtDownloadJob[] }`. Throttled to once per second during progress. |
| `audio-cover-status` | S→C | no | [server/index.ts:4688](../../server/index.ts#L4688) | `admin` | `{ jobs: AudioCoverJob[] }`. Throttled during progress. |
| `caches-cleared` | S→C | no | [server/index.ts:2948](../../server/index.ts#L2948) | `admin` | `{ ts: number }`. Fired after `POST /caches/clear`. |
| `cache-started` | S→C | no | [server/index.ts:1622](../../server/index.ts#L1622) | `admin` | `{ kind: 'sdr' \| 'compressed'; video; start; end; track? }`. A segment encode started. |
| `cache-ready` | S→C | no | [server/index.ts:1763](../../server/index.ts#L1763) | `admin` | `{ kind; video; start; end; track? }`. A segment encode finished. |
| `gamemaster-answer` | C→S→C | **yes** | any PWA | `shared` (show writes, gamemaster reads) | Current answer card state. Show-PWA emits; only the *active* show's emits are kept. |
| `gamemaster-controls` | C→S→C | **yes** | any PWA | `shared` (show writes, gamemaster reads) | Current controls / phase / gameIndex. Show-PWA emits; gamemaster reads. |
| `gamemaster-command` | C→S→C | **no** (ephemeral) | gamemaster PWA | `shared` (gamemaster writes, show reads) | One-shot command from gamemaster to show (`next`, `award`, `use-joker`, ...). |
| `gamemaster-team-state` | C→S→C | **yes** | any PWA | `shared` | Team members, points, joker usage. Any PWA may emit; all others reconcile. |
| `gamemaster-correct-answers` | C→S→C | **yes** | any PWA | `shared` | `{ [gameIndex]: { [teamId]: number } }` tally. |
| `show-presence` | S→C (targeted) | no | [server/ws.ts:231](../../server/ws.ts#L231) | `frontend` | Sent only to show-registered clients: `{ isActive: boolean }`. Only one active show at a time. |
| `show-reemit-request` | S→C (targeted) | no | [server/ws.ts:273](../../server/ws.ts#L273) | `frontend` | Server asks the active show to re-emit its cached state. Fired on any new WS connection. |

### 2.1 Client→server meta messages

These aren't channels — they ride on the same socket with `{ type, ... }` envelopes. See [server/ws.ts:40-41](../../server/ws.ts#L40-L41).

| Type | Sender | Server behavior |
|------|--------|-----------------|
| `show-register` | `frontend` only | Adds the socket to the show-client set. If there's no active show yet, this socket becomes the active show. Server then broadcasts presence to every registered show. |
| `show-claim` | `frontend` only | Forces this socket to become the active show (used by the "Take over" button when a stale active show is detected). |

**Channel total:** 16 named channels + 2 meta control messages = **18 wire-level contracts**.

---

## 3. Zone → contract map

This is the raw material for the three `docs/replace-*.md` guides. For each zone, a replacement service must implement (client-side) exactly the endpoints and channels listed.

### 3.1 Frontend (show PWA) contract surface

**REST:**
- `GET /api/settings`
- `GET /api/theme`, `PUT /api/theme` (ThemeContext drives theme changes from whichever PWA the user is in)
- `GET /api/game/:index`
- `GET /api/background-music`
- `GET /api/video-hdr`
- `POST /api/backend/stream-notify` (signals the server to throttle background work while a video/audio stream is active)
- `GET /videos-compressed/:start/:end/*splat`
- `GET /videos-sdr/:start/:end/*splat`
- `GET /local-assets/**` (asset serving)

**WebSocket channels (subscribe):**
- `gamemaster-controls` — receive phase/gameIndex changes pushed by gamemaster
- `gamemaster-command` — receive one-shot commands from gamemaster
- `gamemaster-team-state` — receive team/joker state changes
- `gamemaster-correct-answers` — receive correct-answer tallies
- `show-presence` — receive active-show status
- `show-reemit-request` — receive re-emit trigger

**WebSocket channels (publish):**
- `gamemaster-answer` — publish current answer state for gamemaster to see
- `gamemaster-controls` — publish current controls/phase/gameIndex
- `gamemaster-team-state` — publish local mutations (team points, joker used)
- `gamemaster-correct-answers` — publish local mutations

**Meta messages (send):**
- `show-register` — on connect
- `show-claim` — on "take over"

### 3.2 Admin (CMS PWA) contract surface

**REST:**
- All 46 `/api/backend/*` endpoints listed in §1.3 – §1.12.
- `GET /api/theme`, `PUT /api/theme` (for admin-side theme switching)
- `GET /api/settings` (for display only — admin reads, doesn't write)

**WebSocket channels (subscribe):**
- `system-status`, `asset-storage`, `assets-changed`, `asset-duration`
- `yt-download-status`, `audio-cover-status`
- `caches-cleared`, `cache-started`, `cache-ready`

### 3.3 Gamemaster (live-control PWA) contract surface

**REST:**
- `GET /api/settings`
- `GET /api/game/:index`

**WebSocket channels (subscribe):**
- `gamemaster-answer` — read current answer state from active show
- `gamemaster-controls` — read current controls/phase/gameIndex
- `gamemaster-team-state` — read current team/joker state
- `gamemaster-correct-answers` — read current tallies

**WebSocket channels (publish):**
- `gamemaster-command` — emit commands to the show
- `gamemaster-team-state` — mutate team/joker state from gamemaster
- `gamemaster-correct-answers` — mutate tallies from gamemaster

---

## 4. Shared payload type references

Types marked with `✅` are already exported from [src/types/config.ts](../../src/types/config.ts) or [src/services/backendApi.ts](../../src/services/backendApi.ts) and will be transcribed verbatim into OpenAPI components.

Types marked with `🆕` have no TS definition today and will be introduced as JSON Schema components (and — if the codebase needs them — back-ported as TS types in a later task).

| Type | Defined in | Used by |
|------|-----------|---------|
| `SettingsResponse` | ✅ [src/types/config.ts](../../src/types/config.ts) | `GET /api/settings` |
| `GameDataResponse` | ✅ [src/types/config.ts](../../src/types/config.ts) | `GET /api/game/:index` |
| `AppConfig` | ✅ [src/types/config.ts](../../src/types/config.ts) | `GET/PUT /api/backend/config` |
| `GameConfig` (union) | ✅ [src/types/config.ts](../../src/types/config.ts) | `GET/PUT /api/backend/games/:fileName` |
| `GameFileSummary` | ✅ [src/types/config.ts](../../src/types/config.ts) | `GET /api/backend/games` |
| `AssetCategory` | ✅ [src/types/config.ts](../../src/types/config.ts) | every `/api/backend/assets/:category/...` |
| `AssetListResponse` | ✅ [src/types/config.ts](../../src/types/config.ts) | `GET /api/backend/assets/:category` |
| `BandleCatalogEntry` | ✅ [src/types/config.ts](../../src/types/config.ts) | `GET /api/backend/bandle/catalog` |
| `VideoProbeResult` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | `GET /api/backend/assets/videos/probe` |
| `VideoTrackInfo`, `VideoStreamInfo` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | component of `VideoProbeResult` |
| `CachedTracks` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | `GET /api/backend/assets/videos/cached-tracks` |
| `WarmPreviewVideo` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | `GET /api/backend/assets/videos/warm-preview` |
| `MissingCacheEntry` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | `GET /api/backend/cache-status`, `WarmAllEvent` |
| `WarmAllEvent`, `WarmupSdrEvent`, `FaststartEvent` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | SSE events |
| `YouTubeDownloadEvent`, `YtDownloadJob` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | YouTube routes + `yt-download-status` channel |
| `AudioCoverEvent`, `AudioCoverJob`, `AudioCoverJobFile` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | audio-cover routes + `audio-cover-status` channel |
| `ReferenceRoot`, `ReferenceBrowseEntry`, `ReferenceBrowseResponse` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | reference video browsing |
| `UnlockPrecheckResponse` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | video-guess unlock precheck |
| `UndoDeleteResult`, `MergeAssetResult` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | asset delete/merge |
| `SystemStatusResponse` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | `GET /api/backend/system-status` + `system-status` channel |
| `WhisperJob`, `WhisperHealth`, `WhisperLanguage`, `WhisperStatus`, `WhisperPhase` | ✅ [src/services/backendApi.ts](../../src/services/backendApi.ts) | whisper routes |
| `GamemasterAnswerData` | ✅ [src/hooks/useGamemasterSync.ts](../../src/hooks/useGamemasterSync.ts) | `gamemaster-answer` channel |
| `GamemasterControlsData` | ✅ [src/hooks/useGamemasterSync.ts](../../src/hooks/useGamemasterSync.ts) | `gamemaster-controls` channel |
| `GamemasterCommand` | ✅ [src/hooks/useGamemasterSync.ts](../../src/hooks/useGamemasterSync.ts) | `gamemaster-command` channel |
| `TeamState`, `GlobalSettings`, `CurrentGame` | ✅ [src/types/game.ts](../../src/types/game.ts) | `gamemaster-team-state` channel + client state |

No 🆕 types required — everything is already typed in the TypeScript codebase.

---

## 5. Questions / gaps surfaced during inventory

1. **`PUT /api/theme` zone attribution.** ✅ Resolved: `shared`. [ThemeContext.tsx](../../src/context/ThemeContext.tsx) calls `saveTheme()` with either `{ frontend }` or `{ admin }` depending on which PWA the user is in.
2. **`POST /api/backend/stream-notify` caller.** ✅ Resolved: `frontend` zone. Callers are [Lightbox.tsx](../../src/components/layout/Lightbox.tsx), [VideoGuess.tsx](../../src/components/games/VideoGuess.tsx), [useVideoPlayback.ts](../../src/services/useVideoPlayback.ts). Body is `{ active: boolean }`, not `{ playing; source }`. Historical `/api/backend/` prefix aside, this is a frontend endpoint.
3. **`asset-duration` channel.** Exists in the `WsChannel` union and in broadcast call sites, but the top-of-file comment in `server/ws.ts` lists only 11 channels by name. This inventory includes it (16 total) because it's in the authoritative union. → **Action**: Phase 8 doc updates should refresh the `server/ws.ts` top comment to list all 16 channels.
4. **Whisper pause/resume/stop routes.** Declared in a `for` loop at line 5419 so they share a line number. OpenAPI will still emit three separate operations. Non-issue.
5. **SSE vs JSON dual-response endpoints.** Five endpoints (`faststart`, `warmup-sdr`, `warmup-compressed`, `cache-warm-all`, `youtube-download`, `audio-cover-fetch`) return either JSON (short-circuit) or SSE. OpenAPI 3.1 will describe both via `content: application/json` AND `content: text/event-stream`. Contract tests will exercise both paths.
6. **No auth header today.** OpenAPI will declare `security: []` globally with a prominent note that replacement services MAY add auth; doing so would break all three current PWAs, so it's out of scope for this work.

---

## 6. Next step

With this inventory as the reviewed source of truth, Phase 2 is to transcribe it into `specs/api/openapi.yaml` (REST) and `specs/api/asyncapi.yaml` (WebSocket). Each row in the tables above becomes one OpenAPI operation or one AsyncAPI operation. The type references in §4 become `components/schemas` entries, one-to-one.
