# Spec: Admin System Status Dashboard

## Goal
A read-only "System" tab in the admin panel that provides a structured, auto-refreshing overview of all background processes, caches, storage, and server health — enabling the operator to quickly diagnose issues during a live event.

## Acceptance criteria
- [x] New "System" tab appears as the last entry in the admin sidebar
- [x] Tab is accessible via `/admin#system` (hash-based routing, like other tabs)
- [x] Dashboard polls `GET /api/backend/system-status` every 5 seconds and renders the response
- [x] **Server section**: shows uptime (human-readable), Node version, memory usage (RSS + heap used / heap total), ffmpeg availability, yt-dlp availability + path
- [x] **Storage section**: shows NAS mount status (green/red indicator), current storage mode (NAS / local), storage base path, disk usage per asset category (images, audio, background-music, videos, audio-guess) with file count and total size
- [x] **Cache section**: shows track remux cache (entry count + total disk size), SDR tone-map cache (entry count + total disk size), HDR metadata cache (entry count), with expandable file lists for track and SDR caches
- [x] **Active processes section**: lists running transcode jobs (file, phase, progress %), running YouTube downloads (title/URL, phase, progress %), background metadata tasks (track-cache warming, audio normalization, poster fetching, SDR warmup, NAS mirroring) with status indicators and elapsed time, shows "Keine aktiven Prozesse" when idle
- [x] **Config section**: shows active gameshow name, game count in gameOrder, total game files on disk
- [x] All UI text is in German
- [x] No state mutations — the tab is purely read-only

## State / data changes
- No changes to `AppState` or `GameContext`
- New API endpoint: `GET /api/backend/system-status` → `SystemStatusResponse`
- Not persisted to localStorage

## API contract

```typescript
interface BackgroundTaskInfo {
  id: string;
  type: 'track-cache' | 'sdr-warmup' | 'audio-normalize' | 'poster-fetch' | 'nas-mirror' | 'hdr-probe';
  label: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
  elapsed: number; // seconds
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
    nasMount: { active: boolean; reachable: boolean };
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
- Cache clearing actions (defer to v2)
- Process killing / cancellation from this tab
- Config validation runner (CLI-only tool)
- NAS sync trigger from this tab
- Disk usage for NAS-mounted paths (only local-assets computed)
