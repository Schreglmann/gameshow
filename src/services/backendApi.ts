import type { AppConfig, GameFileSummary, AssetCategory, AssetListResponse } from '../types/config';
import { isStreamActive } from './networkPriority';

const BASE = '/api/backend';

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Games ──

export async function fetchGames(): Promise<GameFileSummary[]> {
  const data = await apiRequest<{ games: GameFileSummary[] }>(`${BASE}/games`);
  return data.games;
}

export async function fetchGame(fileName: string): Promise<unknown> {
  return apiRequest(`${BASE}/games/${encodeURIComponent(fileName)}`);
}

export async function saveGame(fileName: string, gameFile: unknown): Promise<void> {
  await apiRequest(`${BASE}/games/${encodeURIComponent(fileName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gameFile),
  });
}

export async function createGame(fileName: string, gameFile: unknown): Promise<void> {
  await apiRequest(`${BASE}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, gameFile }),
  });
}

export async function deleteGame(fileName: string): Promise<void> {
  await apiRequest(`${BASE}/games/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
}

export async function renameGame(fileName: string, newFileName: string): Promise<{ newFileName: string }> {
  return apiRequest(`${BASE}/games/${encodeURIComponent(fileName)}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newFileName }),
  });
}

// ── Bandle Catalog ──

export async function fetchBandleCatalog(): Promise<import('@/types/config').BandleCatalogEntry[]> {
  return apiRequest<import('@/types/config').BandleCatalogEntry[]>(`${BASE}/bandle/catalog`);
}

export async function fetchBandleAudioStatus(bandlePath: string): Promise<{ available: boolean; tracks: string[] }> {
  return apiRequest(`${BASE}/bandle/audio-status/${encodeURIComponent(bandlePath)}`);
}

export async function fetchBandleAvailableAudio(): Promise<string[]> {
  const data = await apiRequest<{ folders: string[] }>(`${BASE}/bandle/available-audio`);
  return data.folders;
}

// ── Config ──

export async function fetchConfig(): Promise<AppConfig> {
  return apiRequest<AppConfig>(`${BASE}/config`);
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await apiRequest(`${BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

// ── Assets ──

export async function fetchAssetStorage(): Promise<{ mode: 'local'; path: string; nasMounted: boolean }> {
  return apiRequest(`${BASE}/asset-storage`);
}

export async function fetchAssets(category: AssetCategory): Promise<AssetListResponse> {
  return apiRequest<AssetListResponse>(`${BASE}/assets/${category}`);
}

const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB
const CHUNK_THRESHOLD = 10 * 1024 * 1024; // 10 MB — files above this use chunked upload
const THROTTLED_SPEED = 2 * 1024 * 1024; // 2 MB/s when video is playing

/** Whether the current chunked upload is being throttled (for UI display). */
let _throttled = false;
export function isUploadThrottled() { return _throttled; }

export async function uploadAsset(
  category: AssetCategory,
  file: File,
  subfolder?: string,
  onProgress?: (percent: number, loaded?: number, total?: number) => void,
  onPhase?: (phase: 'uploading' | 'processing') => void,
  signal?: AbortSignal,
): Promise<string> {
  if (file.size > CHUNK_THRESHOLD) {
    return uploadAssetChunked(category, file, subfolder, onProgress, onPhase, signal);
  }
  return uploadAssetSingle(category, file, subfolder, onProgress, onPhase, signal);
}

/** Original single-request upload for small files. */
function uploadAssetSingle(
  category: AssetCategory,
  file: File,
  subfolder?: string,
  onProgress?: (percent: number, loaded?: number, total?: number) => void,
  onPhase?: (phase: 'uploading' | 'processing') => void,
  signal?: AbortSignal,
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const url = subfolder
    ? `${BASE}/assets/${category}/upload?subfolder=${encodeURIComponent(subfolder)}`
    : `${BASE}/assets/${category}/upload`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress?.(pct, e.loaded, e.total);
        if (pct >= 100) {
          onPhase?.('processing');
        }
      }
    });

    xhr.upload.addEventListener('load', () => {
      onPhase?.('processing');
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { fileName: string };
          resolve(data.fileName);
        } catch {
          reject(new Error('Invalid server response'));
        }
      } else {
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string };
          reject(new Error(body.error || xhr.statusText));
        } catch {
          reject(new Error(xhr.statusText));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload fehlgeschlagen')));
    xhr.addEventListener('abort', () => reject(new DOMException('Upload abgebrochen', 'AbortError')));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
}

/** Chunked upload for large files with dynamic throttling. */
async function uploadAssetChunked(
  category: AssetCategory,
  file: File,
  subfolder?: string,
  onProgress?: (percent: number, loaded?: number, total?: number) => void,
  onPhase?: (phase: 'uploading' | 'processing') => void,
  signal?: AbortSignal,
): Promise<string> {
  const uploadId = crypto.randomUUID();
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let uploaded = 0;

  const sfParam = subfolder ? `&subfolder=${encodeURIComponent(subfolder)}` : '';

  try {
    for (let i = 0; i < totalChunks; i++) {
      if (signal?.aborted) throw new DOMException('Upload abgebrochen', 'AbortError');

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const chunkStart = performance.now();

      const form = new FormData();
      form.append('chunk', chunk);

      const res = await fetch(
        `${BASE}/assets/${category}/upload-chunk?uploadId=${uploadId}&chunkIndex=${i}&totalChunks=${totalChunks}&fileName=${encodeURIComponent(file.name)}${sfParam}`,
        { method: 'POST', body: form, signal },
      );
      const resBody = await res.json().catch(() => ({ error: res.statusText }));
      if (!res.ok) {
        throw new Error((resBody as { error?: string }).error || res.statusText);
      }

      uploaded += (end - start);
      const pct = Math.round((uploaded / file.size) * 100);
      onProgress?.(pct, uploaded, file.size);

      // Dynamic throttle: if a video is playing, limit to THROTTLED_SPEED
      const streaming = isStreamActive();
      _throttled = streaming;
      if (streaming && i < totalChunks - 1) {
        const chunkBytes = end - start;
        const elapsed = (performance.now() - chunkStart) / 1000;
        const targetTime = chunkBytes / THROTTLED_SPEED;
        const delay = Math.max(0, targetTime - elapsed);
        if (delay > 0) {
          await new Promise<void>(r => {
            const timer = setTimeout(r, delay * 1000);
            signal?.addEventListener('abort', () => { clearTimeout(timer); r(); }, { once: true });
          });
        }
      }
    }

    _throttled = false;

    // All chunks sent — finalize
    onPhase?.('processing');

    const finalRes = await fetch(`${BASE}/assets/${category}/upload-finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, fileName: file.name, totalChunks, subfolder }),
      signal,
    });
    if (!finalRes.ok) {
      const body = await finalRes.json().catch(() => ({ error: finalRes.statusText }));
      throw new Error((body as { error?: string }).error || finalRes.statusText);
    }
    const data = await finalRes.json() as { fileName: string };
    return data.fileName;
  } catch (e) {
    _throttled = false;
    // Best-effort cleanup on abort/error
    fetch(`${BASE}/assets/${category}/upload-abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
    }).catch(() => {});
    throw e;
  }
}

export interface VideoTrackInfo {
  index: number;
  codec: string;
  codecLong: string;
  channels: number;
  channelLayout: string;
  language: string;
  name: string;
  isDefault: boolean;
  browserCompatible: boolean;
}

export interface VideoStreamInfo {
  width: number;
  height: number;
  codec: string;
  codecLong: string;
  fps: number;
  duration: number;
  bitrate: number;
  fileSize: number;
  isHdr: boolean;
  colorTransfer: string;
  colorPrimaries: string;
  pixFmt: string;
}

export interface VideoProbeResult {
  tracks: VideoTrackInfo[];
  needsTranscode: boolean;
  videoInfo: VideoStreamInfo | null;
}

export async function probeVideo(filePath: string): Promise<VideoProbeResult> {
  return apiRequest(`${BASE}/assets/videos/probe?path=${encodeURIComponent(filePath)}`);
}

// Full-file transcoding (HDR→SDR and audio→AAC) has been removed from the client. The
// cache-based mechanic (segment cache + track remux with AAC audio) replaces it. The server
// still exposes POST /api/backend/assets/videos/transcode but no UI calls it.

export interface WarmPreviewVideo {
  path: string;
  needsTrackCache: boolean;
  tracksCached: number;
  tracksTotal: number;
  needsHdrProbe: boolean;
  isHdr: boolean | null;
  needsAudioTranscode: boolean;
  incompatibleCodecs: string[];
}

export async function fetchWarmPreview(): Promise<{ videos: WarmPreviewVideo[] }> {
  return apiRequest(`${BASE}/assets/videos/warm-preview`);
}

export async function warmAllVideoCaches(selected?: Array<{ path: string; trackCache: boolean; hdrProbe: boolean; audioTranscode: boolean }>): Promise<{ queued: number }> {
  return apiRequest(`${BASE}/assets/videos/warm-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selected }),
  });
}

export interface WarmupSdrEvent {
  percent?: number;
  done?: boolean;
  cached?: boolean;
  error?: string;
}

/**
 * Check if an HDR→SDR cached segment exists for the given video/range/track.
 * Returns true if the cache file is ready, false otherwise.
 */
export async function checkSdrCache(
  video: string,
  start: number,
  end: number,
  track?: number,
): Promise<boolean> {
  const params = new URLSearchParams({ video, start: String(start), end: String(end) });
  if (track !== undefined) params.set('track', String(track));
  const res = await fetch(`${BASE}/assets/videos/sdr-cache-status?${params}`);
  if (!res.ok) return false;
  const data = await res.json() as { cached: boolean };
  return data.cached;
}

/** Shared POST+SSE helper: sends {video,start,end,track?}, returns JSON immediately if the
 *  server reports the cache already exists, else streams `data: { percent }` events.
 *  Accepts an optional AbortSignal so the caller can cancel (e.g. preview paused > 10 s,
 *  see specs/video-caching.md idle-cancel). */
async function runSegmentWarmup(
  endpoint: 'warmup-sdr' | 'warmup-compressed',
  video: string,
  start: number,
  end: number,
  onEvent: ((event: WarmupSdrEvent) => void) | undefined,
  track: number | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  const res = await fetch(`${BASE}/assets/videos/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video, start, end, ...(track !== undefined && { track }) }),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await res.json() as WarmupSdrEvent;
    onEvent?.(data);
    return;
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6)) as WarmupSdrEvent;
      onEvent?.(event);
      if (event.error) throw new Error(event.error);
    }
  }
}

/**
 * Pre-transcode an HDR video segment to SDR.
 * Returns SSE stream; calls onEvent for each progress update.
 */
export async function warmupSdr(
  video: string,
  start: number,
  end: number,
  onEvent?: (event: WarmupSdrEvent) => void,
  track?: number,
  signal?: AbortSignal,
): Promise<void> {
  return runSegmentWarmup('warmup-sdr', video, start, end, onEvent, track, signal);
}

/**
 * Pre-transcode a SDR video segment (H.264 CRF 23, max 1080p).
 * Returns SSE stream; calls onEvent for each progress update.
 */
export async function warmupCompressed(
  video: string,
  start: number,
  end: number,
  onEvent?: (event: WarmupSdrEvent) => void,
  track?: number,
  signal?: AbortSignal,
): Promise<void> {
  return runSegmentWarmup('warmup-compressed', video, start, end, onEvent, track, signal);
}

export interface MissingCacheEntry {
  game: string;
  instance: string | null;
  questionIndex: number;
  video: string;
  start: number;
  end: number;
  track?: number;
  kind: 'compressed' | 'sdr';
}

/** Pre-flight: which video-guess segment caches are missing for the active (or named)
 *  gameshow. Shown as a warning banner on HomeScreen. */
export async function fetchCacheStatus(gameshow?: string): Promise<{ gameshow: string; total: number; missing: MissingCacheEntry[] }> {
  const url = gameshow ? `${BASE}/cache-status?gameshow=${encodeURIComponent(gameshow)}` : `${BASE}/cache-status`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cache-status ${res.status}`);
  return res.json();
}

export interface WarmAllEvent {
  index?: number;
  total?: number;
  current?: MissingCacheEntry;
  percent?: number;
  phase?: string;
  error?: string;
  done?: boolean;
  warmed?: number;
  failed?: Array<MissingCacheEntry & { error: string }>;
}

/** Warm every missing cache for a gameshow through the shared background queue.
 *  Streams SSE progress until `done: true`. Caller should pass an AbortSignal so a
 *  user-initiated cancel aborts the in-flight ffmpeg via the server's request-close hook. */
export async function warmAllCaches(
  onEvent: (event: WarmAllEvent) => void,
  gameshow?: string,
  signal?: AbortSignal,
): Promise<void> {
  const url = gameshow ? `${BASE}/cache-warm-all?gameshow=${encodeURIComponent(gameshow)}` : `${BASE}/cache-warm-all`;
  const res = await fetch(url, { method: 'POST', signal });
  if (!res.ok) throw new Error(`cache-warm-all ${res.status}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      onEvent(JSON.parse(line.slice(6)) as WarmAllEvent);
    }
  }
}

export async function fetchVideoCover(fileName: string): Promise<{ posterPath: string | null; logs: string[] }> {
  const res = await fetch(`${BASE}/assets/videos/fetch-cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName }),
  });
  const data = await res.json() as { posterPath?: string | null; logs?: string[]; error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { logs: data.logs ?? [] });
  return { posterPath: data.posterPath ?? null, logs: data.logs ?? [] };
}

export async function downloadImageFromUrl(
  category: AssetCategory,
  url: string,
  subfolder?: string,
): Promise<string> {
  const data = await apiRequest<{ fileName: string }>(`${BASE}/assets/${category}/download-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, subfolder: subfolder || undefined }),
  });
  return data.fileName;
}

export async function createAssetFolder(category: AssetCategory, folderPath: string): Promise<void> {
  await apiRequest(`${BASE}/assets/${category}/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath }),
  });
}

export async function deleteAsset(category: AssetCategory, filePath: string): Promise<void> {
  await apiRequest(`${BASE}/assets/${category}/${filePath}`, { method: 'DELETE' });
}

export async function moveAsset(category: AssetCategory, from: string, to: string): Promise<void> {
  await apiRequest(`${BASE}/assets/${category}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
}

export interface YouTubeDownloadEvent {
  phase: 'resolving' | 'downloading' | 'processing' | 'done' | 'error';
  percent?: number;
  title?: string;
  fileName?: string;
  message?: string;
  jobId?: string;
  // Playlist-specific fields (only present for playlist downloads)
  playlistTitle?: string;
  trackIndex?: number;
  trackCount?: number;
}

export interface YtDownloadJob {
  id: string;
  category: string;
  phase: 'resolving' | 'downloading' | 'processing' | 'done' | 'error';
  percent: number;
  title: string;
  fileName?: string;
  error?: string;
  startedAt: number;
  playlistTitle?: string;
  trackIndex?: number;
  trackCount?: number;
  tracks?: { title: string; phase: 'resolving' | 'downloading' | 'processing' | 'done'; percent: number }[];
}

export async function cancelYtDownload(jobId: string): Promise<void> {
  await apiRequest(`${BASE}/yt-download-cancel/${jobId}`, { method: 'POST' });
}

export async function fetchYtDownloadStatus(): Promise<YtDownloadJob[]> {
  const data = await apiRequest<{ jobs: YtDownloadJob[] }>(`${BASE}/yt-download-status`);
  return data.jobs;
}

export async function youtubeDownload(
  category: AssetCategory,
  url: string,
  subfolder?: string,
  onEvent?: (event: YouTubeDownloadEvent) => void,
  playlist?: boolean,
): Promise<string> {
  const res = await fetch(`${BASE}/assets/${category}/youtube-download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, subfolder: subfolder || undefined, playlist: playlist || undefined }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || res.statusText);
  }

  // Parse SSE stream
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fileName = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6)) as YouTubeDownloadEvent;
      onEvent?.(event);
      if (event.phase === 'error') throw new Error(event.message || 'Download fehlgeschlagen');
      if (event.phase === 'done') fileName = event.fileName || '';
    }
  }

  return fileName;
}

// ── Audio cover fetch ─────────────────────────────────────────────────────────

export interface AudioCoverEvent {
  jobId?: string;
  phase: 'searching' | 'done' | 'error' | 'confirm';
  fileIndex?: number;
  fileCount?: number;
  fileName?: string;
  coverPath?: string | null;
  message?: string;
  fileDone?: boolean;
  filePhase?: 'done' | 'error';
  rateLimited?: boolean;
  // Confirm phase fields
  foundArtist?: string;
  foundTrack?: string;
  coverPreview?: string;
  source?: string;
}

export interface AudioCoverJobFile {
  name: string;
  phase: 'pending' | 'searching' | 'done' | 'error';
  coverPath?: string | null;
}

export interface AudioCoverJob {
  id: string;
  phase: 'searching' | 'done' | 'error';
  fileIndex: number;
  fileCount: number;
  fileName: string;
  files: AudioCoverJobFile[];
  startedAt: number;
  error?: string;
}

export async function fetchAudioCoverList(): Promise<string[]> {
  const data = await apiRequest<{ covers: string[] }>(`${BASE}/audio-covers/list`);
  return data.covers;
}

export async function cancelAudioCoverFetch(jobId: string): Promise<void> {
  await apiRequest(`${BASE}/audio-cover-cancel/${jobId}`, { method: 'POST' });
}

export async function dismissAudioCoverJob(jobId: string): Promise<void> {
  await apiRequest(`${BASE}/audio-cover-job/${jobId}`, { method: 'DELETE' });
}

export async function fetchAudioCoverStatus(): Promise<AudioCoverJob[]> {
  const data = await apiRequest<{ jobs: AudioCoverJob[] }>(`${BASE}/audio-cover-status`);
  return data.jobs;
}

export async function confirmAudioCover(jobId: string, fileIndex: number, accept: boolean): Promise<void> {
  await apiRequest(`${BASE}/audio-cover-confirm/${jobId}/${fileIndex}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accept }),
  });
}

export async function audioCoverFetch(
  files: string[],
  onEvent?: (event: AudioCoverEvent) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/audio-cover-fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || res.statusText);
  }

  // Parse SSE stream
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6)) as AudioCoverEvent;
      onEvent?.(event);
      if (event.phase === 'error' && !event.fileIndex) throw new Error(event.message || 'Cover-Fetch fehlgeschlagen');
    }
  }
}

export async function fetchAssetUsages(
  category: AssetCategory,
  file: string
): Promise<{ fileName: string; title: string; instance?: string; markers?: { start?: number; end?: number }[]; questionIndices?: number[] }[]> {
  const data = await apiRequest<{ games: { fileName: string; title: string; instance?: string; markers?: { start?: number; end?: number }[]; questionIndices?: number[] }[] }>(
    `${BASE}/asset-usages?category=${category}&file=${encodeURIComponent(file)}`
  );
  return data.games;
}

// ── System Status ──

export interface SystemStatusResponse {
  server: {
    uptimeSeconds: number;
    nodeVersion: string;
    memoryMB: { rss: number; heapUsed: number; heapTotal: number };
    cpu: { processPercent: number; systemPercent: number; loadAvg: [number, number, number]; cores: number };
    network: {
      bandwidthInPerSec: number;
      bandwidthOutPerSec: number;
    };
    ffmpegAvailable: boolean;
    ytDlpAvailable: boolean;
    ytDlpPath: string | null;
  };
  storage: {
    nasMount: { reachable: boolean };
    mode: 'local';
    basePath: string;
    categories: Array<{ name: string; fileCount: number; totalSizeBytes: number }>;
  };
  caches: {
    track: { count: number; totalSizeBytes: number; files: string[] };
    sdr: { count: number; totalSizeBytes: number; files: string[] };
    hdr: { count: number };
  };
  processes: {
    ytDownloads: Array<{ id: string; title?: string; phase: string; percent: number; playlistTotal?: number; playlistDone?: number }>;
    backgroundTasks: Array<{ id: string; type: string; label: string; status: 'running' | 'done' | 'error'; detail?: string; elapsed: number }>;
  };
  config: {
    activeGameshow: string;
    gameOrderCount: number;
    totalGameFiles: number;
  };
  nasSync: {
    status: 'idle' | 'syncing' | 'error';
    queueLength: number;
    currentOp: string | null;
    throttled: boolean;
    bytesSynced: number;
    startupSync: { phase: 'scanning' | 'syncing' | 'done'; total: number; done: number } | null;
    lastRescanAt: number | null;
  };
}

export async function fetchSystemStatus(): Promise<SystemStatusResponse> {
  return apiRequest<SystemStatusResponse>(`${BASE}/system-status`);
}
