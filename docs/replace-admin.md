# Replacing the admin (CMS) PWA

The admin PWA is the operator-facing CMS served at `/admin/`. It owns:
- Games tab — game file CRUD, per-game editor per game type.
- Config tab — `config.json` editor (active gameshow, game order, rules, enabled jokers, team randomization).
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
| `POST` | `/api/backend/games/:fileName/rename` | Rename + rewrite `gameOrder` references. |
| `DELETE` | `/api/backend/games/:fileName` | Delete. Rejects if referenced in any gameshow. |
| `POST` | `/api/backend/games/:fileName/instances/:instance/unlock-precheck` | Pre-flight for video-guess instance unlock. |

### Config

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/backend/config` | Read `config.json`. |
| `PUT` | `/api/backend/config` | Atomic write + validate. |

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
| `GET` | `/api/backend/asset-usages?category&file` | Which games reference this asset. |

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
