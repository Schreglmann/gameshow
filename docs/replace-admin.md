# Replacing the admin (CMS) PWA

The admin PWA is the operator-facing CMS served at `/admin/`. It owns:
- Games tab — game file CRUD, per-game editor per game type.
- Config tab — `config.json` editor (active gameshow, game order, rules, enabled jokers, team randomization, rules presets — see [specs/rules-presets.md](../specs/rules-presets.md)).
- Assets tab — Digital Asset Manager (images/audio/videos/background-music/bandle-audio).
- System Status tab — live server metrics, NAS sync, background jobs, caches.
- Gamemaster-control iframe embeds (the admin screen can host a gamemaster view for cross-device control).

A replacement admin PWA must implement the full `/api/backend/*` surface listed below plus the shared endpoints. Full schemas: [`openapi.yaml`](../specs/api/openapi.yaml).

## Required HTTP endpoints

### Shared with other PWAs

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/settings` | Display the active gameshow meta in the admin header. |
| `GET` | `/api/theme` | Current theme names. |
| `PUT` | `/api/theme` | Save admin (or frontend) theme switch. |

### Games CRUD

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/backend/games` | List every game file with metadata (`GameFileSummary[]`). |
| `GET` | `/api/backend/games/:fileName` | Read a game file verbatim. |
| `PUT` | `/api/backend/games/:fileName` | Atomic write. Rejects invalid payloads. |
| `POST` | `/api/backend/games` | Create a new game file. |
| `POST` | `/api/backend/games/examples` | Generate example games ("Beispiele") + media and activate the example gameshow (see [specs/example-games.md](../specs/example-games.md)). |
| `POST` | `/api/backend/games/:fileName/rename` | Rename + rewrite `gameOrder` references. |
| `DELETE` | `/api/backend/games/:fileName` | Delete + cascade-remove every `gameOrder` reference to it from all gameshows. Returns `{ success, removedRefs }`. |
| `DELETE` | `/api/backend/games/:fileName/instances/:instance` | Delete one instance + cascade-remove its `gameOrder` ref. Returns `{ success, removedRefs }`. |
| `POST` | `/api/backend/games/:fileName/instances/:instance/unlock-precheck` | Pre-flight for video-guess instance unlock. |

### Config

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/backend/config` | Read `config.json`. Includes `rulesPresets[]` when defined; this field is admin-only — show/gamemaster never see it. |
| `PUT` | `/api/backend/config` | Atomic write + validate. `rulesPresets[]` is persisted verbatim. |

### Assets / DAM

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/backend/assets/:category` | Recursive list. |
| `POST` | `/api/backend/assets/:category/upload` | Single-file upload ≤ 10 MB. |
| `POST` | `/api/backend/assets/:category/upload-chunk` | One chunk of a large upload. |
| `POST` | `/api/backend/assets/:category/upload-finalize` | Assemble uploaded chunks. |
| `POST` | `/api/backend/assets/:category/upload-abort` | Clean up an aborted upload. |
| `POST` | `/api/backend/assets/:category/download-url` | Download from URL (image categories). |
| `POST` | `/api/backend/assets/:category/move` | Move/rename + rewrite game references. |
| `POST` | `/api/backend/assets/:category/merge` | Merge duplicates. |
| `POST` | `/api/backend/assets/:category/mkdir` | Create subfolder. |
| `DELETE` | `/api/backend/assets/:category/*splat` | Soft-delete to `.trash/`. Optional `?batchId=` groups into one undoable batch. |
| `POST` | `/api/backend/assets/undo-delete` | Restore the most recent batch. |
| `GET` | `/api/backend/assets/:category/trash` | List every surviving soft-delete batch. Backs the Papierkorb view. |
| `GET` | `/api/backend/assets/:category/trash/list?batchId=&path=` | Direct children of a path inside a trash batch (folder navigation). Does NOT collapse single-child folders. |
| `POST` | `/api/backend/assets/:category/trash/restore` | `{ batchId, items? }` → restore selected entries (top-level or nested paths) or the whole batch. Skips conflicts. |
| `POST` | `/api/backend/assets/:category/trash/purge` | `{ batchId?, items? }` → permanent delete; `items` accepts nested paths. Empties the whole category when both are omitted. |
| `GET` | `/api/backend/assets/:category/trash/stream?batchId=&path=` | Stream a single trashed file's bytes (preview modals). `Cache-Control: no-store`. |
| `GET` | `/api/backend/asset-usages?category&file` | Which games reference this asset. |
| `GET` | `/api/backend/asset-folder-usages?category&folder` | Which games reference any file inside this folder. Single backend call; returns `truncated: true` above the 5000-file cap. Used by the delete-confirm modal to warn before wiping a folder full of in-use assets. |
| `POST` | `/api/backend/assets/images/search` | Multi-provider image search (DuckDuckGo + Commons + GitHub-SVG). |
| `POST` | `/api/backend/assets/images/replace` | Atomic byte-swap with backup + game-ref rewrite on extension change. |
| `GET` | `/api/backend/assets/images/upscale/info` | Probe whether the local-AI upscaler (Real-ESRGAN via upscayl-ncnn) is installed. |
| `POST` | `/api/backend/assets/images/upscale` | Run local-AI upscale on an image — `dryRun: true` returns a preview URL; `dryRun: false` replaces atomically. Optional feature; gate the UI on `upscale/info.available`. |
| `GET` | `/api/backend/assets/images/upscale/preview/:cacheKey` | Stream a cached preview (in-memory; cleared on Node restart). |
| `GET` | `/api/backend/assets/images/upscale/progress/:progressId` | SSE stream of per-tile upscale percents while the AI runs. Optional — for showing a loading bar. |

### Video tooling (admin-specific)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/backend/assets/videos/probe?path` | ffprobe: tracks, HDR, faststart, needsTranscode. |
| `GET` | `/api/backend/assets/videos/reference-roots` | User-filesystem roots suitable for browsing. |
| `GET` | `/api/backend/assets/videos/reference-browse?path` | Directory browsing for reference videos. |
| `POST` | `/api/backend/assets/videos/add-reference` | Symlink an external video into the DAM. |
| `POST` | `/api/backend/assets/videos/fetch-cover` | Auto-fetch a movie poster by filename. |
| `POST` | `/api/backend/assets/videos/faststart` | Rewrite faststart atom. JSON short-circuit or SSE stream. |
| `GET` | `/api/backend/assets/videos/faststart-status?path` | Peek at in-flight faststart progress. |
| `GET` | `/api/backend/assets/videos/cached-tracks?video&start&end` | Which track variants are cached. |
| `GET` | `/api/backend/assets/videos/sdr-cache-status` | Whether an HDR→SDR cache exists. |
| `GET` | `/api/backend/assets/videos/cache-check` | Aggregate cache-readiness for a segment list. |
| `POST` | `/api/backend/assets/videos/warmup-sdr` | Pre-transcode HDR→SDR segment. SSE. |
| `POST` | `/api/backend/assets/videos/warmup-compressed` | Pre-transcode H.264 segment. SSE. |
| `GET` | `/api/backend/assets/videos/warm-preview` | Preview what warm-all would touch. |
| `POST` | `/api/backend/assets/videos/warm-all` | Queue warmup for selected videos. |

### Cache management (gameshow-level)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/backend/cache-status` | Missing segment caches for a gameshow. |
| `POST` | `/api/backend/cache-warm-all` | Warm every missing cache. SSE. |
| `POST` | `/api/backend/cache-warm-all/cancel` | Cancel the run. |
| `POST` | `/api/backend/caches/clear` | Wipe SDR + compressed + HDR. |

### YouTube download

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/backend/assets/:category/youtube-download` | Audio/video/playlist download. SSE. |
| `POST` | `/api/backend/yt-download-cancel/:jobId` | Cancel. |

### Audio cover auto-fetch

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/backend/audio-covers/list` | Already-fetched covers. |
| `POST` | `/api/backend/audio-cover-fetch` | Batch cover lookup. SSE. |
| `POST` | `/api/backend/audio-cover-cancel/:jobId` | Cancel. |
| `POST` | `/api/backend/audio-cover-confirm/:jobId/:fileIndex` | Accept/reject a found cover. |
| `DELETE` | `/api/backend/audio-cover-job/:jobId` | Dismiss a done/errored job. |

### Bandle integration

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/backend/bandle/catalog` | Bandle track catalog for the `bandle` game editor. |
| `GET` | `/api/backend/bandle/available-audio` | Downloaded Bandle audio files. |
| `GET` | `/api/backend/bandle/audio-status/:bandlePath` | Per-track download status. |
| `POST` | `/api/backend/bandle/download-audio` | Queue download. |

### System status

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/backend/system-status` | Same payload as the WS `system-status` channel, on demand. |

### Whisper transcription

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/backend/assets/videos/whisper/health` | Is whisper.cpp installed? |
| `GET` | `/api/backend/assets/videos/whisper/jobs` | All jobs. |
| `GET` | `/api/backend/assets/videos/whisper/status?path` | One-video status. |
| `GET` | `/api/backend/assets/videos/whisper/transcript?path` | Completed transcript text. |
| `POST` | `/api/backend/assets/videos/whisper/start` | Start a job. |
| `POST` | `/api/backend/assets/videos/whisper/{pause,resume,stop}` | Lifecycle. |

### Spellcheck ("Lektorat")

German + English spelling + grammar check via LanguageTool (proxied server-side; endpoint
configurable via `LANGUAGETOOL_URL`, language via `LANGUAGETOOL_LANGUAGE`, default `auto`).
Each field is checked in its own request with per-field language auto-detection, so English
answers aren't flagged as German. Config + allowlist persist in repo-root `spellcheck-allowlist.json`.
The feature is globally **off by default** (`enabled: false`) — a replacement admin must read
`GET /allowlist` and hide all spellcheck UI when `enabled` is false.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/backend/spellcheck/health` | Is LanguageTool reachable? |
| `GET` | `/api/backend/spellcheck/rate-status` | `{ throttling, waiting, retryAfterMs, windowCount, windowMax }`. Poll while scanning to show a "waiting on rate limit" banner. |
| `GET` | `/api/backend/spellcheck/allowlist` | Config: `{ version, enabled, allowedWords, ignoredMatches }`. |
| `POST` | `/api/backend/spellcheck/set-enabled` | `{ enabled }` → updated config. Global master switch. |
| `POST` | `/api/backend/spellcheck/allow-word` | `{ word }` → updated config. |
| `POST` | `/api/backend/spellcheck/remove-word` | `{ word }` → updated config. |
| `POST` | `/api/backend/spellcheck/ignore-match` | `{ fingerprint }` → updated config. |
| `POST` | `/api/backend/spellcheck/remove-ignore` | `{ fingerprint }` → updated config. |
| `POST` | `/api/backend/spellcheck/check` | `{ segments: { key, text }[] }` → `{ results: { key, matches }[] }`. Offsets are LOCAL to each segment (UTF-16 units); matches are already allowlist-filtered. |

**Fingerprint contract:** a match's fingerprint is `` `${ruleId}::${matched}` `` where `matched`
is the flagged substring `NFC`-normalized, lowercased and trimmed. Compute it identically on
the client to know whether a match is already ignored (and which "Ignorieren" to send).

## Required WebSocket channels

All admin channels are server→client push. The admin never publishes on the WebSocket — its writes go through HTTP endpoints, which the server broadcasts to everyone via WS.

| Channel | Cached? | Purpose |
|---------|---------|---------|
| `system-status` | no | Periodic (2s). Metrics, processes, caches, NAS sync. |
| `asset-storage` | no | Periodic (5s). Storage mode + NAS reachability. |
| `asset-duration` | no | Batched durations while the admin enumerates a category. |
| `assets-changed` | no | Fired after every DAM mutation. Trigger an asset list re-fetch. |
| `yt-download-status` | no | YouTube job state (throttled 1/s). |
| `audio-cover-status` | no | Audio-cover job state (throttled). |
| `caches-cleared` | no | Fired after `POST /caches/clear`. |
| `cache-started` | no | A segment encode started. |
| `cache-ready` | no | A segment encode finished. |
| `content-changed` | no | `{ config?, theme?, games? }`. On `theme`, re-fetch `GET /api/theme` so a theme switch made elsewhere applies live. (The admin's own `PUT /api/theme` write triggers this same event back to it — re-applying the value it just set is a harmless no-op.) |

## SSE conventions

Several endpoints return either JSON (short-circuit) or `text/event-stream`. Parse by inspecting the `Content-Type` header:

```ts
const res = await fetch(url, { method: 'POST', body, ... });
if (res.headers.get('content-type')?.includes('application/json')) {
  const data = await res.json();         // short-circuit path
} else {
  // SSE: lines shaped `data: <JSON>\n\n`
  const reader = res.body!.getReader();
  // ... read and parse events
}
```

Endpoints that always stream SSE:
- `POST /api/backend/cache-warm-all`
- `POST /api/backend/assets/:category/youtube-download`
- `POST /api/backend/audio-cover-fetch`

Endpoints that either short-circuit to JSON or stream SSE:
- `POST /api/backend/assets/videos/faststart`
- `POST /api/backend/assets/videos/warmup-sdr`
- `POST /api/backend/assets/videos/warmup-compressed`

## Build & serve contract

- **Mount point**: `/admin/` (set `base: "/admin/"` in your build tool).
- **Service worker scope**: `/admin/`.
- **Manifest**: linked from `admin/index.html`.
- **Build output**: static files under `dist/client/admin/`.

## What NOT to do from a replacement admin

- **Don't write to `gamemaster-*` WebSocket channels.** Those are the show/gamemaster contract.
- **Don't directly edit files in `games/`, `config.json`, or `local-assets/` from the client.** The admin PWA always goes through the `/api/backend/*` endpoints so the server can enforce atomicity, validation, and reference rewrites.
- **Don't cache `/api/backend/config` across mutations.** The server re-reads `config.json` per request; downstream `/api/game/:index` must see the same values.
- **Don't skip the `assets-changed` WS push.** Invalidating your asset list on this event is how the UI stays fresh.
