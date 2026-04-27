# Spec: Admin System Status Dashboard

## Goal
A read-only "System" tab in the admin panel that provides a structured, auto-refreshing overview of all background processes, caches, storage, and server health — enabling the operator to quickly diagnose issues during a live event.

## Acceptance criteria
- [x] New "System" tab appears as the last entry in the admin sidebar
- [x] Tab is accessible via `/admin#system` (hash-based routing, like other tabs)
- [x] Dashboard polls `GET /api/backend/system-status` every 5 seconds and renders the response
- [x] **Server section**: shows uptime (human-readable), Node version, memory usage (RSS + heap used / heap total), ffmpeg availability, yt-dlp availability + path
- [x] **Storage section**: shows NAS mount status (green/red indicator), current storage mode (NAS / local), storage base path, disk usage per asset category (images, audio, background-music, videos, audio-guess) with file count and total size
- [x] **Cache section**: shows SDR tone-map cache (entry count + total disk size), compressed segment cache (entry count + total disk size), HDR metadata cache (entry count), with expandable file lists for SDR and compressed caches
- [x] **Clear caches**: a destructive-styled "Alle Caches löschen" button in the Caches section wipes SDR, compressed and HDR caches after a `confirm()` prompt; inline result summary shows cleared counts; cache stats refresh within ~2 s via the existing WebSocket push
- [x] **Active processes section**: lists running transcode jobs (file, phase, progress %), running YouTube downloads (title/URL, phase, progress %), background metadata tasks (SDR warmup, compressed warmup, audio normalization, poster fetching, NAS mirroring, HDR probe) with status indicators and elapsed time, shows "Keine aktiven Prozesse" when idle
- [x] **Unified job list** under Active Processes: YouTube downloads, background tasks, and Whisper transcriptions render as one sorted list — no separate sub-sections. Each row shows a standard type prefix and icon:
  - `🎬 Video-Cache:` (sdr-warmup / compressed-warmup)
  - `🎙️ Whisper:` (whisper-asr / whisper source)
  - `⬇️ YouTube:` (yt source, with playlist counter folded into the detail line)
  - `🔄 NAS-Sync:` (nas-sync)
  - `🔃 NAS-Initial-Sync:` (startup-sync)
  - `🔊 Audio-Normalisierung:` (audio-normalize)
  - `🖼️ Poster:` (poster-fetch)
  - `📊 HDR-Probe:` (hdr-probe)
  - `⚡ Faststart:` (faststart)
- [x] **Queued jobs are visible and marked**: background tasks that are waiting for the shared ffmpeg encode slot appear with dimmed styling and a "In Warteschlange" label (no progress bar, no elapsed seconds). This replaces the prior invisibility where queued work only surfaced after acquiring a slot.
- [x] **Batch cache generation** (`cache-warm-all`) creates a queued bgTask for every missing cache up-front and fires all encodes concurrently — the whole queue is visible in the System tab the moment warm-all starts (gated to 2 concurrent encodes by `BG_ENCODE_CONCURRENCY`).
- [x] **Fast cleanup**: completed tasks disappear after **5 seconds**; errored tasks after **30 seconds** (previously 30 s / 60 s).
- [x] Row sort order: running first (preserving insertion order), then queued, then errored at the bottom.
- [x] **Config section**: shows active gameshow name, game count in gameOrder, total game files on disk
- [x] All UI text is in German
- [x] No state mutations — the tab is purely read-only

## State / data changes
- No changes to `AppState` or `GameContext`
- New API endpoint: `GET /api/backend/system-status` → `SystemStatusResponse`
- New API endpoint: `POST /api/backend/caches/clear` → `{ cleared: { sdr: number; compressed: number; hdr: number } }`
- Not persisted to localStorage

## API contract

```typescript
interface BackgroundTaskInfo {
  id: string;
  type: 'sdr-warmup' | 'compressed-warmup' | 'audio-normalize' | 'poster-fetch'
      | 'nas-mirror' | 'hdr-probe' | 'nas-sync' | 'startup-sync' | 'faststart' | 'whisper-asr';
  label: string;
  status: 'queued' | 'running' | 'done' | 'error';
  detail?: string;
  elapsed: number; // seconds — 0 while queued; based on runningAt once started
  queuedAt?: number;
  runningAt?: number;
  /** Structured metadata — used by `VideoGuessForm` to correlate running/queued
   *  cache jobs to per-question buttons so those buttons disable themselves when
   *  the same cache is already being generated elsewhere (warm-all, auto-warmup,
   *  a second operator). */
  meta?: {
    video?: string;
    start?: number;
    end?: number;
    track?: number;
    kind?: 'compressed' | 'sdr';
  };
}

interface SystemStatusResponse {
  server: {
    uptimeSeconds: number;
    nodeVersion: string;
    memoryMB: { rss: number; heapUsed: number; heapTotal: number };
    ffmpegAvailable: boolean;
    ytDlpAvailable: boolean;
    ytDlpPath: string | null;
  };
  storage: {
    nasMount: { reachable: boolean };
    mode: 'nas' | 'local';
    basePath: string;
    categories: Array<{
      name: string;
      fileCount: number;
      totalSizeBytes: number;
    }>;
  };
  caches: {
    track: { count: number; totalSizeBytes: number; files: string[] };
    sdr: { count: number; totalSizeBytes: number; files: string[] };
    hdr: { count: number };
  };
  processes: {
    transcodes: Array<{
      filePath: string;
      phase: string;
      percent: number;
      status: string;
      elapsed?: number;
    }>;
    ytDownloads: Array<{
      id: string;
      url: string;
      phase: string;
      percent: number;
      title?: string;
      playlistTotal?: number;
      playlistDone?: number;
    }>;
    backgroundTasks: BackgroundTaskInfo[];
  };
  config: {
    activeGameshow: string;
    gameOrderCount: number;
    totalGameFiles: number;
  };
}
```

## UI behaviour
- Screen: `AdminScreen` → `SystemTab`
- Layout: stacked `backend-card` sections, each with a heading
- Status indicators: green dot (●) for healthy/active, red dot (●) for unavailable/error
- Cache file lists: collapsed by default, toggle to expand
- Auto-refresh: 5-second polling interval, pauses when tab is not active
- Memory/sizes displayed in human-readable format (MB, GB)

## Out of scope
- Per-cache granular clearing (one "clear all" button only)
- Process killing / cancellation from this tab
- Config validation runner (CLI-only tool)
- NAS sync trigger from this tab
- Disk usage for NAS-mounted paths (only local-assets computed)
