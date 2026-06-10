import express from 'express';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, readdirSync, createReadStream, createWriteStream } from 'fs';
import { readdir, readFile, writeFile, unlink, rename, mkdir, rm, rmdir, stat, copyFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import multer from 'multer';
import type { AppConfig, GameConfig, MultiInstanceGameFile, GameFileSummary, AssetCategory, RulesPreset } from '../src/types/config.js';
import { resolveRulesPreset } from '../src/utils/rulesPreset.js';
import { isAudioFile, normalizeAudioFile } from './normalize.js';
import { fetchAndSavePoster, videoFilenameToSlug, MOVIE_POSTERS_SUBDIR } from './movie-posters.js';
import { fetchAndSaveAudioCover, audioCoverFilename, AUDIO_COVERS_SUBDIR, audioFilenameToSearchQuery, searchItunes, type CoverSearchResult } from './audio-covers.js';
import { addAlias as addAssetAlias, readAliasMap, resolveAlias, resolveAliasChecked } from './asset-alias-map.js';
import {
  readAudioCoverMeta,
  setAudioCoverMeta,
  deleteAudioCoverMeta,
  renameAudioCoverMeta,
  type AudioCoverSource,
} from './audio-cover-meta.js';
import { fetchUrl } from './movie-posters.js';
import {
  readReferenceMap,
  addReference as addVideoReferenceEntry,
  removeReference as removeVideoReferenceEntry,
  renameReference as renameVideoReferenceEntry,
  type VideoReferenceMap,
} from './video-reference-map.js';
import { probeVideoTracks, buildTonemapVf, type ProbeResult } from './video-probe.js';
import { computeSyncOps, buildNewSyncState, resolvePrevFiles, parseSyncState, applySnapshotOp, applyDeletionSafety, checkBulkDelete, makeRunId, type SyncState, type SyncOp } from './nas-sync.js';
import { collectFileMetadata, collectTrashedRelPaths } from './nas-walk.js';
import { pruneTrash, softDelete } from './sync-safety.js';
import { ROOT_DIR, NAS_BASE, LOCAL_ASSETS_BASE } from './asset-paths.js';
import { setupWebSocket, broadcast, broadcastThrottled } from './ws.js';
import { startContentWatch } from './content-watch.js';
import { isGitCryptBlob, loadConfigWithFallback, ensureConfigFile } from './clean-install.js';
import { pruneGameOrder, parseGameRef, isRefToGame, isRefToInstance } from './game-order.js';
import type { RemovedGameRef } from './game-order.js';
import { materializeExamples } from './example-games.js';
import { setupWhisperJobs, type WhisperLanguage } from './whisper-jobs.js';
import { checkSegments, checkLanguageToolHealth, getRateLimitStatus, LanguageToolError, type SpellSegmentInput } from './spellcheck.js';
import { readConfig as readSpellConfig, setEnabled as setSpellEnabled, setSkipNames as setSpellSkipNames, addWord as addSpellWord, removeWord as removeSpellWord, addIgnore as addSpellIgnore, removeIgnore as removeSpellIgnore } from './spellcheck-allowlist.js';
import { getStatus as getLtDockerStatus, start as startLtDocker, stop as stopLtDocker, cancel as cancelLtDocker, detectOnStartup as detectLtDockerOnStartup } from './languagetool-docker.js';
import { getColorProfile, warmColorProfile, isSupportedImageForColorProfile } from './color-profile.js';
import { searchImages as searchImagesOrchestrator } from './image-search.js';
import type { ImageSearchProvider } from './image-search-types.js';
import { searchYouTube } from './youtube-search.js';
import {
  loadManifests as loadSvgManifests,
  refreshManifest as refreshSvgManifest,
  refreshAllManifests as refreshAllSvgManifests,
  deleteManifest as deleteSvgManifest,
  deleteAllManifests as deleteAllSvgManifests,
  getManifestStatus as getSvgManifestStatus,
  type SvgManifestId,
} from './svg-manifest.js';
import { fetchImageBytesFromUrl, sniffImageExt } from './image-fetch.js';
import { findFreeBasename } from './find-free-basename.js';
import {
  initDimensionCache,
  saveDimensionCache,
  getCachedDimensions,
  probeImageDimensions,
  warmImageDimensions,
  isProbeableImageForDimensions,
} from './image-dimensions.js';
import { resolveVideoGuessLanguage } from './video-guess-resolver.js';
import {
  TRASH_BATCH_ID_RE,
  assertSafeTrashOriginalPath,
  mediaTypeFromPath,
  type TrashMediaType,
} from './trash-helpers.js';
import { randomUUID } from 'crypto';
import {
  UPSCALE_MODELS,
  UPSCALE_SCALES,
  UPSCALE_SUPPORTED_EXTS,
  UpscaleError,
  buildCacheKey as buildUpscaleCacheKey,
  getCachedUpscale,
  isUpscalerAvailable,
  setProgressListener as setUpscaleProgressListener,
  upscaleImage,
  type UpscaleModel,
  type UpscaleScale,
} from './upscale.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const GAMES_DIR = path.join(ROOT_DIR, 'games');
const THEME_SETTINGS_PATH = path.join(ROOT_DIR, 'theme-settings.json');

// ── Persistent video cache (survives server restarts) ──
const VIDEO_CACHE_BASE = path.join(LOCAL_ASSETS_BASE, 'videos', '.cache');
const NAS_CACHE_BASE = path.join(NAS_BASE, 'videos', '.cache');

/** Convert a relative video path to a safe flat filename for caching.
 *  NFD-normalise first so the slug is identical regardless of whether the input
 *  comes from the macOS filesystem (always NFD) or from a hardcoded string (NFC). */
function cacheSlug(relPath: string): string {
  return relPath.normalize('NFD').replace(/[/\\]/g, '__').replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Deterministic cache file path for an SDR tone-mapped segment. */
function sdrCacheFile(relPath: string, startSec: number, endSec: number): string {
  const base = cacheSlug(relPath).replace(/\.[^.]+$/, '');
  return path.join(VIDEO_CACHE_BASE, 'sdr', `${base}__${startSec}_${endSec}.mp4`);
}

/** Resolve a relative video path to an absolute path (prefers local when sizes match). Cached 10s. */
// Local-first: always resolve videos from local-assets
function resolveVideoPath(relPath: string): string | null {
  const localPath = path.join(LOCAL_ASSETS_BASE, 'videos', relPath);
  return existsSync(localPath) ? localPath : null;
}

// ── Reference-only videos (see specs/video-references.md) ──

/** OS-aware default reference roots. macOS uses /Volumes + home; Linux uses /mnt + /media + home. */
function defaultReferenceRoots(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') return ['/Volumes', home];
  return ['/mnt', '/media', home];
}

/** Parse and normalize the configured reference roots (deduplicated). */
function getReferenceRoots(): string[] {
  const raw = process.env.GAMESHOW_REFERENCE_ROOTS;
  const roots = raw && raw.trim()
    ? raw.split(':').map(s => s.trim()).filter(Boolean)
    : defaultReferenceRoots();
  const resolved = roots.map(r => path.resolve(r));
  return Array.from(new Set(resolved));
}

/** Optional display label for a root (e.g. "Home" for the user's home directory). */
function labelForRoot(p: string): string | undefined {
  if (p === os.homedir()) return 'Home';
  return undefined;
}

/** Allowed video extensions for references. Kept lowercase. */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mkv', '.mov', '.webm', '.avi', '.ts', '.mts', '.m2ts']);

function isVideoExtension(name: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** Verify an absolute path lives inside one of the configured reference roots. */
function isPathWithinReferenceRoots(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  for (const root of getReferenceRoots()) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

/** Short-lived cache for the reference map (cleared on add/remove/rename). */
let _referenceMapCache: { map: VideoReferenceMap; ts: number } | null = null;
const REFERENCE_MAP_CACHE_TTL = 2_000;
async function getReferenceMapCached(): Promise<VideoReferenceMap> {
  const now = Date.now();
  if (_referenceMapCache && now - _referenceMapCache.ts < REFERENCE_MAP_CACHE_TTL) {
    return _referenceMapCache.map;
  }
  const map = await readReferenceMap(path.join(LOCAL_ASSETS_BASE, 'videos'));
  _referenceMapCache = { map, ts: now };
  return map;
}
function invalidateReferenceMapCache(): void { _referenceMapCache = null; }

const HDR_CACHE_FILE = path.join(VIDEO_CACHE_BASE, 'hdr.json');

// ── Probe cache (persistent) — avoids repeated ffprobe calls for unchanged files,
// and lets offline references keep surfacing their track/HDR metadata so the UI
// doesn't regress (language picker disappearing, cache keys flipping) when the
// source volume is disconnected.
const PROBE_CACHE_FILE = path.join(VIDEO_CACHE_BASE, 'probe.json');
const probeResultCache = new Map<string, { mtimeMs: number; result: ProbeResult }>();

function loadProbeCache(): void {
  try {
    const data = JSON.parse(readFileSync(PROBE_CACHE_FILE, 'utf-8')) as Record<string, { mtimeMs: number; result: ProbeResult }>;
    for (const [k, v] of Object.entries(data)) probeResultCache.set(k, v);
  } catch { /* first run or missing */ }
}
loadProbeCache();

let _probeSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveProbeCache(): void {
  if (_probeSaveTimer) return;
  _probeSaveTimer = setTimeout(() => {
    _probeSaveTimer = null;
    try {
      mkdirSync(path.dirname(PROBE_CACHE_FILE), { recursive: true });
      const obj: Record<string, { mtimeMs: number; result: ProbeResult }> = {};
      for (const [k, v] of probeResultCache) obj[k] = v;
      writeFileSync(PROBE_CACHE_FILE, JSON.stringify(obj) + '\n');
    } catch { /* non-critical */ }
  }, 500);
}

/** Probe a video file, returning cached result if the file hasn't changed. */
async function cachedProbe(fullPath: string, relPath: string): Promise<ProbeResult> {
  const mtimeMs = await stat(fullPath).then(s => s.mtimeMs, () => 0);
  const cached = probeResultCache.get(relPath);
  if (cached && mtimeMs > 0 && cached.mtimeMs === mtimeMs) return cached.result;
  const result = await probeVideoTracks(fullPath);
  probeResultCache.set(relPath, { mtimeMs, result });
  saveProbeCache();
  return result;
}

interface HdrCacheEntry {
  isHdr: boolean;
  maxCLL: number; // Maximum Content Light Level in nits (0 = unknown)
}

/** Load persisted HDR cache from disk. */
function loadHdrCache(): Map<string, HdrCacheEntry> {
  try {
    const data = JSON.parse(readFileSync(HDR_CACHE_FILE, 'utf-8')) as Record<string, HdrCacheEntry>;
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

/** Persist HDR cache to disk and mirror to NAS (debounced — coalesces rapid writes). */
let _hdrSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveHdrCache(): void {
  if (_hdrSaveTimer) return; // already scheduled
  _hdrSaveTimer = setTimeout(() => {
    _hdrSaveTimer = null;
    mkdirSync(path.dirname(HDR_CACHE_FILE), { recursive: true });
    writeFileSync(HDR_CACHE_FILE, JSON.stringify(Object.fromEntries(hdrCache), null, 2) + '\n');
    mirrorHdrCacheToNas();
  }, 500);
}


/** Invalidate system-status cache-dir stats so next poll re-scans. */
function invalidateCacheDirStats(): void { _cacheDirStatsCache = null; }

/** Delete all persistent cache files whose slug starts with the given prefix. */
function deleteCacheFilesForVideo(relPath: string): void {
  invalidateCacheDirStats();
  const slug = cacheSlug(relPath).replace(/\.[^.]+$/, '');
  for (const base of [VIDEO_CACHE_BASE, NAS_CACHE_BASE]) {
    for (const subdir of ['sdr', 'compressed']) {
      const dir = path.join(base, subdir);
      try {
        for (const file of readdirSync(dir)) {
          if (file.startsWith(slug + '__')) {
            try { unlinkSync(path.join(dir, file)); } catch { /* already gone */ }
          }
        }
      } catch { /* dir doesn't exist yet */ }
    }
  }
}

/** Compute the complete set of expected segment cache filenames (basenames, not full paths)
 *  from every `games/*.json`. Used to prune obsolete caches after a save or on startup.
 *  Skips `_template-*.json` — those are never played directly.
 *
 *  Returns a map per subdirectory: { compressed: Set<basename>, sdr: … }.
 *  Each question may contribute multiple entries (different SDR variants). */
async function expectedCacheFilenames(): Promise<{ compressed: Set<string>; sdr: Set<string> }> {
  const expected = { compressed: new Set<string>(), sdr: new Set<string>() };
  let files: string[];
  try { files = await readdir(GAMES_DIR); }
  catch { return expected; }

  // Audio-track-count cache: relPath → number of audio tracks. Used to emit expected
  // filenames for ALL track variants so a language switch doesn't prune other tracks'
  // caches. Marker changes or question deletion still prune because the start/end values
  // (or the entire entry) change.
  const trackCountCache = new Map<string, number>();
  const videosDir = path.join(LOCAL_ASSETS_BASE, 'videos');

  for (const file of files) {
    if (!file.endsWith('.json') || file.startsWith('_template-') || file.includes('.fingerprints.')) continue;
    let raw: string;
    try { raw = await readFile(path.join(GAMES_DIR, file), 'utf8'); }
    catch { continue; }
    let data: unknown;
    try { data = JSON.parse(raw); } catch { continue; }

    // Walk either top-level questions or every instance's questions.
    const instances: Array<{ questions?: Array<Record<string, unknown>> }> = [];
    const d = data as Record<string, unknown>;
    if (d.type === 'video-guess') {
      if (Array.isArray(d.questions)) instances.push({ questions: d.questions as Array<Record<string, unknown>> });
      if (d.instances && typeof d.instances === 'object') {
        for (const [, inst] of Object.entries(d.instances as Record<string, unknown>)) {
          // Include archive instances: cache is kept so it survives question moves
          // between archive and playable instances without re-encoding.
          // Locked instances are likewise preserved so a show can run from cache
          // even when the source files are unreachable (see specs/video-guess-lock.md).
          const qs = (inst as Record<string, unknown>)?.questions;
          if (Array.isArray(qs)) instances.push({ questions: qs as Array<Record<string, unknown>> });
        }
      }
    }

    for (const { questions } of instances) {
      if (!questions) continue;
      for (const q of questions) {
        const video = typeof q.video === 'string' ? q.video : undefined;
        if (!video) continue;
        const relPath = video.replace(/^\/videos\//, '');
        const slug = cacheSlug(relPath).replace(/\.[^.]+$/, '');
        const segStart = typeof q.videoStart === 'number' ? q.videoStart : 0;
        const questionEnd = typeof q.videoQuestionEnd === 'number' ? q.videoQuestionEnd : undefined;
        const answerEnd = typeof q.videoAnswerEnd === 'number' ? q.videoAnswerEnd : undefined;

        // Segment caches (compressed + sdr) are keyed by [start, end, track]. See
        // useEffectiveVideo() in VideoGuess.tsx — segEnd is exactly the last marker;
        // no trailing buffer so the cache cannot contain post-marker (next-scene) content.
        const hasTimeRange = questionEnd !== undefined || answerEnd !== undefined;
        if (hasTimeRange) {
          const segEnd = Math.max(questionEnd ?? segStart, answerEnd ?? 0);
          const baseName = `${slug}__${segStart}_${segEnd}.mp4`;

          // Always keep the no-track variant.
          expected.compressed.add(baseName);
          expected.sdr.add(baseName);

          // Also keep every per-track variant (.t0, .t1, …) so switching the instance
          // language doesn't prune caches for other tracks. The caches are still pruned
          // when markers change (different start/end → different basename) or the question
          // is deleted (no entry emits this basename at all).
          if (!trackCountCache.has(relPath)) {
            let count = 0;
            try {
              const { tracks } = await cachedProbe(path.join(videosDir, relPath), relPath);
              count = tracks.length;
            } catch { /* probe failed — 0 means we only keep the no-track variant */ }
            trackCountCache.set(relPath, count);
          }
          const numTracks = trackCountCache.get(relPath) ?? 0;
          // Also accept an explicit per-question audioTrack that may exceed the probed
          // count (e.g. if the video file was replaced after caching).
          const explicitTrack = typeof q.audioTrack === 'number' ? q.audioTrack : -1;
          const maxTrack = Math.max(numTracks - 1, explicitTrack);
          for (let t = 0; t <= maxTrack; t++) {
            expected.compressed.add(`${baseName}.t${t}`);
            expected.sdr.add(`${baseName}.t${t}`);
          }
        }
      }
    }
  }
  return expected;
}

/** Delete segment caches that no longer correspond to any games/*.json entry.
 *  Keeps `.tmp` files (active encodes) and files in subdirectories.
 *  Also prunes the matching in-memory `ready` sets so a future request re-checks disk.
 *  Runs on startup (~30 s after boot, once HDR probes have populated hdrCache) and after
 *  any game-file save. */
async function pruneUnusedCaches(): Promise<{ compressed: number; sdr: number }> {
  const expected = await expectedCacheFilenames();
  const removed = { compressed: 0, sdr: 0 };

  for (const subdir of ['compressed', 'sdr'] as const) {
    const dir = path.join(VIDEO_CACHE_BASE, subdir);
    let files: string[];
    try { files = readdirSync(dir); }
    catch { continue; }
    for (const file of files) {
      if (file.endsWith('.tmp')) continue;
      if (expected[subdir].has(file)) continue;
      try {
        unlinkSync(path.join(dir, file));
        removed[subdir]++;
      } catch { /* race with another process is fine */ }
    }
  }

  // Keep in-memory ready-sets in sync. We rebuild them lazily on the next request, so
  // simplest + correct behaviour is to clear any entry whose file no longer exists.
  for (const set of [compressedCacheReady, sdrCacheReady]) {
    for (const entry of set) {
      if (!existsSync(entry)) set.delete(entry);
    }
  }

  if (removed.compressed || removed.sdr) {
    invalidateCacheDirStats();
    console.log(`[cache] Pruned ${removed.compressed + removed.sdr} stale files (compressed=${removed.compressed}, sdr=${removed.sdr})`);
  }
  return removed;
}

/** Mirror a local cache file to NAS via the sync queue. */
function mirrorCacheToNas(localFile: string): void {
  if (!isNasMounted()) return;
  const rel = path.relative(VIDEO_CACHE_BASE, localFile);
  const nasFile = path.join(NAS_CACHE_BASE, rel);
  queueNasSync({ type: 'copy', localPath: localFile, nasPath: nasFile, rel: null, label: `Cache → NAS: ${path.basename(localFile)}` });
}

/** Mirror hdr.json to NAS via the sync queue. */
function mirrorHdrCacheToNas(): void {
  if (!isNasMounted()) return;
  const nasHdrFile = path.join(NAS_CACHE_BASE, 'hdr.json');
  queueNasSync({ type: 'copy', localPath: HDR_CACHE_FILE, nasPath: nasHdrFile, rel: null, label: 'Cache → NAS: hdr.json' });
}

/** On startup, pull any NAS cache files that are missing locally. */
async function syncCacheFromNas(): Promise<void> {
  if (!isNasMounted()) return;
  let synced = 0;
  for (const subdir of ['sdr']) {
    const nasDir = path.join(NAS_CACHE_BASE, subdir);
    const localDir = path.join(VIDEO_CACHE_BASE, subdir);
    try {
      const files = await readdir(nasDir);
      await mkdir(localDir, { recursive: true });
      for (const file of files) {
        const localFile = path.join(localDir, file);
        try { await stat(localFile); } catch {
          try {
            await copyFile(path.join(nasDir, file), localFile);
            synced++;
          } catch { /* individual file failed, continue */ }
        }
      }
    } catch { /* NAS dir doesn't exist yet */ }
  }
  // Also restore hdr.json if missing locally
  const nasHdrFile = path.join(NAS_CACHE_BASE, 'hdr.json');
  try {
    await stat(HDR_CACHE_FILE);
  } catch {
    try {
      await stat(nasHdrFile);
      await mkdir(path.dirname(HDR_CACHE_FILE), { recursive: true });
      await copyFile(nasHdrFile, HDR_CACHE_FILE);
      synced++;
    } catch { /* failed to restore hdr.json */ }
  }
  if (synced > 0) console.log(`[cache-sync] Restored ${synced} cache file(s) from NAS`);
}

/** Populate in-memory Sets from existing cache files on disk. */
function populateCacheSets(): void {
  const sdrDir = path.join(VIDEO_CACHE_BASE, 'sdr');
  try {
    for (const file of readdirSync(sdrDir)) {
      sdrCacheReady.add(path.join(sdrDir, file));
    }
  } catch { /* dir doesn't exist yet */ }
  const total = sdrCacheReady.size + hdrCache.size;
  if (total > 0) console.log(`[cache] Loaded ${sdrCacheReady.size} SDR, ${hdrCache.size} HDR entries`);
}

// Returns true when the NAS volume is actually reachable (auto-detected).
// Short TTL when reachable (5s) to detect disconnects quickly.
// Long TTL when unreachable (60s) to avoid hammering a dead mount point.
let _nasMountedCache: { value: boolean; ts: number } = { value: false, ts: 0 };
function isNasMounted(): boolean {
  const now = Date.now();
  const ttl = _nasMountedCache.value ? 5_000 : 60_000;
  if (now - _nasMountedCache.ts < ttl) return _nasMountedCache.value;
  let result = false;
  try { result = statSync(NAS_BASE).isDirectory(); } catch { /* unreachable */ }
  _nasMountedCache = { value: result, ts: now };
  return result;
}

// ── Background task registry (lightweight tracking for metadata processes) ──
/** Structured metadata for cache-related background tasks, used by the admin UI to
 *  correlate running/queued jobs to specific VideoGuess questions so per-question
 *  buttons can disable themselves when a matching cache is already being generated
 *  elsewhere (warm-all, auto-warmup, a second operator). */
interface BackgroundTaskMeta {
  video?: string;
  start?: number;
  end?: number;
  track?: number;
  kind?: 'compressed' | 'sdr';
}

interface BackgroundTask {
  id: string;
  type: 'sdr-warmup' | 'compressed-warmup' | 'audio-normalize' | 'poster-fetch' | 'nas-mirror' | 'hdr-probe' | 'nas-sync' | 'startup-sync' | 'faststart' | 'whisper-asr';
  label: string;
  /** Legacy creation timestamp — preserved for back-compat but `elapsed` now uses
   *  `runningAt ?? queuedAt`. New code should prefer those fields. */
  startedAt: number;
  queuedAt: number;
  runningAt?: number;
  status: 'queued' | 'running' | 'done' | 'error';
  /** Free-form human-readable status text (e.g. `"42 %"` for progressed tasks). Updated
   *  via `bgTaskUpdate` so the System tab sees live progress. */
  detail?: string;
  meta?: BackgroundTaskMeta;
}
const backgroundTasks = new Map<string, BackgroundTask>();
let bgTaskSeq = 0;

function bgTaskStart(type: BackgroundTask['type'], label: string, detail?: string, meta?: BackgroundTaskMeta): string {
  const id = `bg-${++bgTaskSeq}`;
  const now = Date.now();
  backgroundTasks.set(id, { id, type, label, startedAt: now, queuedAt: now, runningAt: now, status: 'running', detail, meta });
  broadcastSystemStatus();
  return id;
}

/** Create a task in the `queued` state — used by work that must first wait for a
 *  concurrency slot (segment cache encodes). Transition to `running` via
 *  `bgTaskMarkRunning` when the slot is acquired. */
function bgTaskQueue(type: BackgroundTask['type'], label: string, detail?: string, meta?: BackgroundTaskMeta): string {
  const id = `bg-${++bgTaskSeq}`;
  const now = Date.now();
  backgroundTasks.set(id, { id, type, label, startedAt: now, queuedAt: now, status: 'queued', detail, meta });
  broadcastSystemStatus();
  return id;
}

/** Transition a queued task to running. No-op if the task is already running or
 *  has been cleared. Resets `runningAt` so `elapsed` reflects actual processing
 *  time, not queue wait. */
function bgTaskMarkRunning(id: string): void {
  const t = backgroundTasks.get(id);
  if (t && t.status === 'queued') {
    t.status = 'running';
    t.runningAt = Date.now();
    broadcastSystemStatus();
  }
}

function bgTaskDone(id: string): void {
  const t = backgroundTasks.get(id);
  if (t) { t.status = 'done'; broadcastSystemStatus(); setTimeout(() => backgroundTasks.delete(id), 5_000); }
}

function bgTaskError(id: string, detail?: string): void {
  const t = backgroundTasks.get(id);
  if (t) { t.status = 'error'; if (detail) t.detail = detail; broadcastSystemStatus(); setTimeout(() => backgroundTasks.delete(id), 30_000); }
}

/** Drop a task silently — used when a caller queued a task that turns out to be a
 *  duplicate of existing work (the cache is already being encoded for another caller).
 *  Unlike `bgTaskDone`, this leaves no trail in the UI; the first caller's task
 *  remains as the single authoritative row for the encode. */
function bgTaskCancel(id: string): void {
  if (backgroundTasks.delete(id)) broadcastSystemStatus();
}

/** Update the `detail` line of a running task (e.g. progress percent). Throttled so a
 *  chatty ffmpeg progress firehose doesn't flood the WebSocket — the underlying
 *  `broadcastSystemStatus` already debounces at 500 ms. */
function bgTaskUpdate(id: string, detail: string): void {
  const t = backgroundTasks.get(id);
  if (t) { t.detail = detail; broadcastSystemStatus(); }
}

/** Trigger an async system-status broadcast (debounced — only fires if >500ms since last). */
let _lastSystemBroadcast = 0;
function broadcastSystemStatus(): void {
  const now = Date.now();
  if (now - _lastSystemBroadcast < 500) return;
  _lastSystemBroadcast = now;
  buildSystemStatusPayload()
    .then(data => broadcast('system-status', data))
    .catch(err => console.warn(`[system-status] broadcast skipped: ${(err as Error).message}`));
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// ── Request & network metrics ──
function getCpuTotals() {
  let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
  for (const cpu of os.cpus()) {
    user += cpu.times.user; nice += cpu.times.nice;
    sys += cpu.times.sys; idle += cpu.times.idle; irq += cpu.times.irq;
  }
  return { user, nice, sys, idle, irq, total: user + nice + sys + idle + irq };
}

const serverMetrics = {
  bytesOut: 0,
  bytesIn: 0,
  prevBytesOut: 0,
  prevBytesIn: 0,
  bandwidthOutPerSec: 0,
  bandwidthInPerSec: 0,
  lastCpuUsage: process.cpuUsage(),
  lastCpuTime: Date.now(),
  cpuPercent: 0,
  lastCpuTotals: getCpuTotals(),
  systemCpuPercent: 0,
};

// Sample CPU + bandwidth every 2 seconds
setInterval(() => {
  const now = Date.now();
  const elapsed = (now - serverMetrics.lastCpuTime) * 1000; // to microseconds
  const usage = process.cpuUsage(serverMetrics.lastCpuUsage);
  serverMetrics.cpuPercent = elapsed > 0 ? Math.min(100, Math.round(((usage.user + usage.system) / elapsed) * 100)) : 0;
  serverMetrics.lastCpuUsage = process.cpuUsage();
  // System-wide CPU from os.cpus() delta
  const cpuNow = getCpuTotals();
  const totalDelta = cpuNow.total - serverMetrics.lastCpuTotals.total;
  const idleDelta = cpuNow.idle - serverMetrics.lastCpuTotals.idle;
  serverMetrics.systemCpuPercent = totalDelta > 0 ? Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)) : 0;
  serverMetrics.lastCpuTotals = cpuNow;
  const elapsedSec = (now - serverMetrics.lastCpuTime) / 1000 || 2;
  serverMetrics.bandwidthOutPerSec = Math.round((serverMetrics.bytesOut - serverMetrics.prevBytesOut) / elapsedSec);
  serverMetrics.bandwidthInPerSec = Math.round((serverMetrics.bytesIn - serverMetrics.prevBytesIn) / elapsedSec);
  serverMetrics.prevBytesOut = serverMetrics.bytesOut;
  serverMetrics.prevBytesIn = serverMetrics.bytesIn;
  serverMetrics.lastCpuTime = now;
}, 2000);

// ── Network host info (local LAN IPs + cached public IP) ──
// Surfaced in the System tab so the operator can see which address to point an
// iPad / phone at. Local IPv4s are read synchronously from the OS on each poll;
// the public IP needs an outbound request, so it's cached and refreshed lazily
// in the background — and strictly best-effort, since a LAN-only event has no
// internet and simply shows no public IP.

/** All non-internal IPv4 addresses, one entry per interface (e.g. en0 = WiFi). */
function getLocalIpv4s(): Array<{ iface: string; address: string }> {
  const out: Array<{ iface: string; address: string }> = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      // Node reports `family` as the string 'IPv4' (or the number 4 in some builds).
      const isV4 = a.family === 'IPv4' || (a.family as unknown) === 4;
      if (isV4 && !a.internal) out.push({ iface: name, address: a.address });
    }
  }
  return out;
}

const PUBLIC_IP_TTL_MS = 10 * 60 * 1000; // refresh at most every 10 min
const _publicIp = { value: null as string | null, fetchedAt: 0, inFlight: false };

/** Returns the cached public IP and kicks off a background refresh when stale.
 *  Never throws and never blocks the system-status build — no internet just
 *  leaves the value at its last (or null) state. */
function getPublicIpCached(): string | null {
  if (!_publicIp.inFlight && Date.now() - _publicIp.fetchedAt > PUBLIC_IP_TTL_MS) {
    _publicIp.inFlight = true;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2500);
    fetch('https://api.ipify.org', { signal: ac.signal })
      .then(r => (r.ok ? r.text() : null))
      .then(text => {
        const ip = text?.trim();
        if (ip && ip.length < 64 && /^[0-9a-fA-F:.]+$/.test(ip)) _publicIp.value = ip;
        _publicIp.fetchedAt = Date.now();
      })
      .catch(() => { _publicIp.fetchedAt = Date.now(); })
      .finally(() => { clearTimeout(timer); _publicIp.inFlight = false; });
  }
  return _publicIp.value;
}

// Track bytes in/out for bandwidth measurement
app.use((req, res, next) => {
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > 0) serverMetrics.bytesIn += contentLength;
  const origEnd = res.end.bind(res);
   
  res.end = function (chunk?: any, ...args: any[]) {
    if (chunk) {
      const len = typeof chunk === 'string' ? Buffer.byteLength(chunk) : (chunk?.length ?? 0);
      serverMetrics.bytesOut += len;
    }
     
    return origEnd(chunk, ...args as any);
  } as typeof res.end;
  next();
});

// Log all error responses to the terminal
app.use((_req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 400) {
      const msg = typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error: string }).error
        : JSON.stringify(body);
      console.error(`[${res.statusCode}] ${_req.method} ${_req.path} — ${msg}`);
    }
    return origJson(body);
  };
  next();
});

// Multer: upload to temp dir, then move to target
// Single-shot uploads are capped; anything larger goes through the chunked
// upload route. Protects the host's tmp disk during a live event.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: MAX_UPLOAD_BYTES } });

// ── Security helpers ──

const ALLOWED_CATEGORIES: AssetCategory[] = ['audio', 'images', 'background-music', 'videos'];

function isSafeFileName(name: string): boolean {
  return !name.includes('..') && !name.includes('\0') && name.length > 0;
}

async function detectJsonIndent(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, 'utf8');
    const match = content.match(/\n( +)"/);
    return match ? match[1].length : 2;
  } catch {
    return 2;
  }
}

// Like isSafeFileName but allows '/' for nested subfolder paths
function isSafePath(p: string): boolean {
  if (!p || p.includes('\0') || path.isAbsolute(p)) return false;
  return p.split('/').every(seg => seg.length > 0 && seg !== '..' && seg !== '.');
}

interface AssetFileMeta { size: number; mtime: number; duration?: number; reference?: { sourcePath: string; online: boolean }; dimensions?: { width: number; height: number }; }
interface FolderListing { name: string; files: string[]; fileMeta?: Record<string, AssetFileMeta>; subfolders: FolderListing[]; }

// ── Lightweight duration probe (ffprobe format.duration only) ──
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import ffprobeStatic from 'ffprobe-static';
const execFileP = promisify(execFileCb);
const FFPROBE_BIN = ffprobeStatic.path ?? 'ffprobe';

/** Persistent duration cache: absolute path → { mtimeMs, duration }.
 *  Loaded from disk on startup, written back after background probes. */
const DURATION_CACHE_FILE = path.join(LOCAL_ASSETS_BASE, '.duration-cache.json');
const durationCache = new Map<string, { mtimeMs: number; duration: number }>();

function loadDurationCache(): void {
  try {
    const raw = JSON.parse(readFileSync(DURATION_CACHE_FILE, 'utf-8')) as Record<string, { mtimeMs: number; duration: number }>;
    for (const [k, v] of Object.entries(raw)) durationCache.set(k, v);
  } catch { /* first run or corrupt — start empty */ }
}
loadDurationCache();

// Persistent image-dimension cache: same pattern as durationCache. Backs the DAM
// "Niedrige Auflösung" filter / "Auflösung" sort. See [server/image-dimensions.ts].
initDimensionCache(path.join(LOCAL_ASSETS_BASE, '.image-dimension-cache.json'));

// Public-repo SVG logo manifests — backs the `github-svg` image-search provider.
// Refreshes in the background; if it fails the provider just returns no hits and
// the orchestrator returns DDG + Commons as usual.
loadSvgManifests(LOCAL_ASSETS_BASE).catch(err => {
  console.warn(`[svg-manifest] startup load failed: ${err instanceof Error ? err.message : err}`);
});

let durationCacheDirty = false;
function saveDurationCache(): void {
  if (!durationCacheDirty) return;
  durationCacheDirty = false;
  try {
    const obj: Record<string, { mtimeMs: number; duration: number }> = {};
    for (const [k, v] of durationCache) obj[k] = v;
    writeFileSync(DURATION_CACHE_FILE, JSON.stringify(obj) + '\n');
  } catch { /* non-critical */ }
}

/** Return cached duration (instant, no I/O). */
function getCachedDuration(filePath: string, mtimeMs: number): number | undefined {
  const cached = durationCache.get(filePath);
  return (cached && cached.mtimeMs === mtimeMs) ? cached.duration : undefined;
}

/** Probe duration with ffprobe (slow). Stores result in cache. */
async function probeDuration(filePath: string, mtimeMs: number): Promise<number | undefined> {
  const cached = getCachedDuration(filePath, mtimeMs);
  if (cached !== undefined) return cached;
  try {
    const { stdout } = await execFileP(FFPROBE_BIN, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', filePath,
    ], { timeout: 5000 });
    const dur = parseFloat(JSON.parse(stdout)?.format?.duration ?? '');
    if (!isNaN(dur) && dur > 0) {
      durationCache.set(filePath, { mtimeMs, duration: dur });
      durationCacheDirty = true;
      return dur;
    }
  } catch { /* skip — file may not be a valid media file */ }
  return undefined;
}

// ── Background duration probing ──
// After the listing response is sent, probe missing durations in the background
// and push updates via WebSocket so the client can sort by duration without waiting.
let bgDurationAbort: AbortController | null = null;

interface PendingDurationFile { filePath: string; relativePath: string; mtimeMs: number; }

/** Collect files missing cached durations from a folder listing. */
function collectMissingDurations(dir: string, listing: FolderListing, prefix: string): PendingDurationFile[] {
  const pending: PendingDurationFile[] = [];
  for (const file of listing.files) {
    const fullPath = path.join(dir, listing.name, file);
    const meta = listing.fileMeta?.[file];
    if (meta && getCachedDuration(fullPath, meta.mtime) === undefined) {
      pending.push({ filePath: fullPath, relativePath: prefix ? `${prefix}/${listing.name}/${file}` : `${listing.name}/${file}`, mtimeMs: meta.mtime });
    }
  }
  const subPrefix = prefix ? `${prefix}/${listing.name}` : listing.name;
  for (const sub of listing.subfolders) {
    pending.push(...collectMissingDurations(path.join(dir, listing.name), sub, subPrefix));
  }
  return pending;
}

function probeDurationsInBackground(category: AssetCategory, dir: string, rootFiles: string[], rootMeta: Record<string, AssetFileMeta>, subfolders: FolderListing[]): void {
  // Abort any previous background probe for a different category
  if (bgDurationAbort) bgDurationAbort.abort();
  const ac = new AbortController();
  bgDurationAbort = ac;

  // Collect all files that need probing
  const pending: PendingDurationFile[] = [];
  for (const file of rootFiles) {
    const fullPath = path.join(dir, file);
    const meta = rootMeta[file];
    if (meta && getCachedDuration(fullPath, meta.mtime) === undefined) {
      pending.push({ filePath: fullPath, relativePath: file, mtimeMs: meta.mtime });
    }
  }
  for (const sub of subfolders) {
    pending.push(...collectMissingDurations(dir, sub, ''));
  }

  if (pending.length === 0) return;

  // Probe in small concurrent batches, broadcasting results periodically
  const BATCH_SIZE = 4;
  const BROADCAST_INTERVAL = 500; // ms — batch WS pushes to avoid flooding

  (async () => {
    const resolved: Record<string, number> = {};
    let lastBroadcast = Date.now();

    const flush = () => {
      if (Object.keys(resolved).length === 0) return;
      broadcast('asset-duration', { category, durations: { ...resolved } });
      for (const k of Object.keys(resolved)) delete resolved[k];
      lastBroadcast = Date.now();
    };

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      if (ac.signal.aborted) return;
      const batch = pending.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(async (p) => {
        const dur = await probeDuration(p.filePath, p.mtimeMs);
        return { relativePath: p.relativePath, duration: dur };
      }));
      for (const r of results) {
        if (r.duration !== undefined) resolved[r.relativePath] = r.duration;
      }
      if (Date.now() - lastBroadcast >= BROADCAST_INTERVAL) flush();
    }
    flush();
    saveDurationCache();
  })().catch(() => { /* background job — errors are non-critical */ });
}


/** Look up any cached duration for `filePath`, ignoring mtime. Used for offline
 *  references where we can't stat the target to get a fresh mtime but still want
 *  to show the last-known duration. */
function getAnyCachedDuration(filePath: string): number | undefined {
  const cached = durationCache.get(filePath);
  return cached?.duration;
}

/** Populate file meta for a single entry in the videos category, tolerating
 *  dangling symlinks (reference files whose source is currently unreachable).
 *  Returns null if the entry should be skipped entirely. */
async function videoFileMeta(
  dir: string,
  entryName: string,
  references: VideoReferenceMap,
  relBase: string,
): Promise<AssetFileMeta | null> {
  const fullPath = path.join(dir, entryName);
  const relPath = relBase ? `${relBase}/${entryName}` : entryName;
  const refEntry = references[relPath];
  try {
    const st = await stat(fullPath); // follows symlinks
    const meta: AssetFileMeta = { size: st.size, mtime: st.mtimeMs };
    const dur = getCachedDuration(fullPath, st.mtimeMs);
    if (dur !== undefined) meta.duration = dur;
    if (refEntry) meta.reference = { sourcePath: refEntry.sourcePath, online: true };
    return meta;
  } catch {
    // stat failed — either the file doesn't exist, or a symlink is dangling.
    // For references, emit an offline entry with last-known metadata.
    if (!refEntry) return null;
    const meta: AssetFileMeta = { size: 0, mtime: refEntry.addedAt };
    const dur = getAnyCachedDuration(fullPath);
    if (dur !== undefined) meta.duration = dur;
    meta.reference = { sourcePath: refEntry.sourcePath, online: false };
    return meta;
  }
}

interface ListFolderOpts {
  references?: VideoReferenceMap;
  relBase?: string;
  /** When true, attach cached image dimensions to each `AssetFileMeta` (raster images
   *  only; SVGs and unprobed files have no `dimensions`). Used for the `images` category. */
  probeDimensions?: boolean;
}

async function listFolderRecursive(dir: string, opts: ListFolderOpts = {}): Promise<FolderListing> {
  // macOS readdir returns NFD-encoded names for filenames with diacritics
  // (e.g. "ö" as o + combining diaeresis). Game JSONs store paths in NFC, so any
  // downstream substring match (DAM usage detection, frontend echo-back) breaks
  // unless we normalize here. Established pattern: see walkFiles/snapshotFiles.
  const name = path.basename(dir).normalize('NFC');
  const { references, relBase = '', probeDimensions = false } = opts;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const subfolders = await Promise.all(
      entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'backup').map(e =>
        listFolderRecursive(path.join(dir, e.name), {
          references,
          relBase: relBase ? `${relBase}/${e.name.normalize('NFC')}` : e.name.normalize('NFC'),
          probeDimensions,
        })
      )
    );
    // When iterating the videos category, symlinks (reference files) are treated as files.
    const isVideoListing = references !== undefined;
    const fileEntries = entries.filter(e => {
      if (e.name.startsWith('.') || e.name.includes('.transcoding.')) return false;
      if (e.isFile()) return true;
      if (isVideoListing && e.isSymbolicLink()) return true;
      return false;
    });
    const files = fileEntries.map(e => e.name.normalize('NFC'));
    const fileMeta: Record<string, AssetFileMeta> = {};
    await Promise.all(fileEntries.map(async e => {
      const nfcName = e.name.normalize('NFC');
      if (isVideoListing) {
        const meta = await videoFileMeta(dir, e.name, references!, relBase);
        if (meta) fileMeta[nfcName] = meta;
        return;
      }
      try {
        const fullPath = path.join(dir, e.name);
        const st = await stat(fullPath);
        const meta: AssetFileMeta = { size: st.size, mtime: st.mtimeMs };
        const dur = getCachedDuration(fullPath, st.mtimeMs);
        if (dur !== undefined) meta.duration = dur;
        if (probeDimensions) {
          const dims = getCachedDimensions(fullPath, st.mtimeMs);
          if (dims !== undefined) meta.dimensions = dims;
        }
        fileMeta[nfcName] = meta;
      } catch { /* skip */ }
    }));
    return { name, files, fileMeta, subfolders };
  } catch {
    return { name, files: [], subfolders: [] };
  }
}

function isSafeCategory(cat: unknown): cat is AssetCategory {
  return typeof cat === 'string' && ALLOWED_CATEGORIES.includes(cat as AssetCategory);
}

// Local-first: all operations use local-assets. NAS is synced in background.
function categoryDir(category: AssetCategory): string {
  return path.join(LOCAL_ASSETS_BASE, category);
}

// Notify all connected DAM clients that a category's contents changed, so they
// can reload without a manual page refresh. Listeners debounce client-side, so
// callers can fire this freely (e.g. per-track in a playlist) without flooding.
function broadcastAssetsChanged(category: AssetCategory): void {
  broadcast('assets-changed', { category });
}

// `audio/bandle/*` is managed by the bandle catalog, `audio/backup/*` holds auto-backups.
// Both are hidden from the DAM and must not participate in cross-category moves.
function isReservedAudioSubpath(from: string): boolean {
  const first = from.split('/')[0];
  return first === 'bandle' || first === 'backup';
}

// ── Soft-delete / undo ─────────────────────────────────────────────────────
// Deletes rename the file/folder into `<categoryDir>/.trash/<batchId>/<original-relpath>`
// so the operation can be reverted. The DAM exposes every surviving batch via the
// Papierkorb view (GET/POST `/api/backend/assets/:category/trash/*`); the existing
// "Rückgängig" toast still operates exclusively on `lastDeletion`, which tracks the
// most recent batch. `.trash` is hidden from all DAM listings because it starts with `.`.

const TRASH_DIRNAME = '.trash';
const TRASH_TTL_MS = 24 * 60 * 60 * 1000; // 24h — discard stale batches at startup
// `TRASH_BATCH_ID_RE`, `assertSafeTrashOriginalPath`, `mediaTypeFromPath`, and
// `TrashMediaType` are imported from ./trash-helpers.js — kept in a separate
// module so the unit tests can exercise them without booting the full server.

interface DeletionEntry {
  originalPath: string;
  trashPath: string;
  isDirectory: boolean;
}

interface DeletionBatch {
  batchId: string;
  category: AssetCategory;
  entries: DeletionEntry[];
  createdAt: number;
}

let lastDeletion: DeletionBatch | null = null;

function trashBatchDir(category: AssetCategory, batchId: string): string {
  return path.join(categoryDir(category), TRASH_DIRNAME, batchId);
}

interface TrashEntryDto {
  originalPath: string;
  isDirectory: boolean;
  sizeBytes: number;
  mediaType: TrashMediaType;
}

interface TrashBatchDto {
  batchId: string;
  createdAt: number;
  expiresAt: number;
  sizeBytes: number;
  isCurrent: boolean;
  entries: TrashEntryDto[];
}

interface TrashDeepEntryDto {
  batchId: string;
  batchCreatedAt: number;
  batchExpiresAt: number;
  originalPath: string;
  sizeBytes: number;
  mediaType: TrashMediaType;
}

/**
 * Walk every surviving trash batch recursively and emit a flat list of every
 * leaf file (no directories). Backs the Papierkorb search so files inside
 * soft-deleted folders are findable — the top-level `/trash` listing collapses
 * folders into single rows, which hides deeply nested files from a token match.
 */
async function listAllTrashFiles(category: AssetCategory): Promise<TrashDeepEntryDto[]> {
  const trashRoot = path.join(categoryDir(category), TRASH_DIRNAME);
  let batchNames: string[];
  try { batchNames = await readdir(trashRoot); }
  catch { return []; }
  const out: TrashDeepEntryDto[] = [];
  for (const name of batchNames) {
    if (!TRASH_BATCH_ID_RE.test(name)) continue;
    const batchDir = path.join(trashRoot, name);
    let st: import('fs').Stats;
    try { st = await stat(batchDir); }
    catch { continue; }
    if (!st.isDirectory()) continue;
    const batchCreatedAt = st.mtimeMs;
    const batchExpiresAt = batchCreatedAt + TRASH_TTL_MS;
    async function walk(rel: string): Promise<void> {
      const full = path.join(batchDir, rel);
      let children: import('fs').Dirent[];
      try { children = await readdir(full, { withFileTypes: true }); }
      catch { return; }
      for (const child of children) {
        if (child.name.startsWith('.')) continue;
        const childRel = rel ? `${rel}/${child.name}` : child.name;
        if (child.isDirectory()) {
          await walk(childRel);
        } else if (child.isFile()) {
          const childFull = path.join(full, child.name);
          let sz = 0;
          try { sz = (await stat(childFull)).size; } catch { /* keep 0 */ }
          out.push({
            batchId: name,
            batchCreatedAt,
            batchExpiresAt,
            originalPath: childRel,
            sizeBytes: sz,
            mediaType: mediaTypeFromPath(childRel, false),
          });
        }
      }
    }
    await walk('');
  }
  return out;
}

/** Recursive `du`-style size in bytes. Errors return 0 so a partial tree never blocks listing. */
async function recursiveSize(full: string): Promise<number> {
  try {
    const st = await stat(full);
    if (!st.isDirectory()) return st.size;
    let total = 0;
    const children = await readdir(full, { withFileTypes: true });
    for (const child of children) {
      total += await recursiveSize(path.join(full, child.name));
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Walk one trash batch directory and return its top-level entries. Soft-deletes
 * are recorded at the same depth they were issued from (a deleted folder is one
 * entry with `isDirectory: true`); the listing mirrors that — never recurses
 * inside a folder entry. The walk is needed because trash older than the current
 * `lastDeletion` has no in-memory record after a server restart.
 */
async function listBatchEntries(category: AssetCategory, batchId: string): Promise<TrashEntryDto[]> {
  const batchDir = trashBatchDir(category, batchId);
  const out: TrashEntryDto[] = [];
  async function walk(rel: string): Promise<void> {
    const full = path.join(batchDir, rel);
    let children: import('fs').Dirent[];
    try { children = await readdir(full, { withFileTypes: true }); }
    catch { return; }
    for (const child of children) {
      if (child.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${child.name}` : child.name;
      const childFull = path.join(full, child.name);
      // If `lastDeletion` covers this batch, prefer its recorded entries so the
      // top-level granularity matches the original soft-delete. Otherwise fall
      // back to the deepest directory whose only child is a single non-leaf —
      // i.e. unwrap mkdir-only path prefixes until we hit the first branch or
      // leaf, which yields exactly the depth the soft-delete recorded.
      if (child.isDirectory()) {
        let dirChildren: import('fs').Dirent[];
        try { dirChildren = await readdir(childFull, { withFileTypes: true }); }
        catch { dirChildren = []; }
        const visible = dirChildren.filter(c => !c.name.startsWith('.'));
        if (visible.length === 1 && visible[0].isDirectory()) {
          await walk(childRel);
          continue;
        }
        const sizeBytes = await recursiveSize(childFull);
        out.push({ originalPath: childRel, isDirectory: true, sizeBytes, mediaType: 'other' });
      } else if (child.isFile()) {
        let sz = 0;
        try { sz = (await stat(childFull)).size; } catch { /* keep 0 */ }
        out.push({ originalPath: childRel, isDirectory: false, sizeBytes: sz, mediaType: mediaTypeFromPath(childRel, false) });
      }
    }
  }
  // Prefer the in-memory record when it matches — it captures the exact
  // top-level entries the soft-delete touched.
  if (lastDeletion && lastDeletion.category === category && lastDeletion.batchId === batchId) {
    for (const entry of lastDeletion.entries) {
      let sz = 0;
      try { sz = entry.isDirectory ? await recursiveSize(entry.trashPath) : (await stat(entry.trashPath)).size; }
      catch { /* keep 0 */ }
      out.push({
        originalPath: entry.originalPath,
        isDirectory: entry.isDirectory,
        sizeBytes: sz,
        mediaType: mediaTypeFromPath(entry.originalPath, entry.isDirectory),
      });
    }
    return out;
  }
  await walk('');
  return out;
}

/**
 * List the *direct* children of a path inside a batch — no single-child
 * unwrapping. Backs the Papierkorb folder navigation: clicking a folder
 * entry lazy-loads its contents via this call. Returns `[]` if the path
 * doesn't exist or isn't a directory inside the batch.
 */
async function listBatchChildren(
  category: AssetCategory,
  batchId: string,
  relPath: string,
): Promise<TrashEntryDto[]> {
  if (!TRASH_BATCH_ID_RE.test(batchId)) return [];
  if (relPath !== '') {
    try { assertSafeTrashOriginalPath(relPath); }
    catch { return []; }
  }
  const full = path.join(trashBatchDir(category, batchId), relPath);
  let st: import('fs').Stats;
  try { st = await stat(full); }
  catch { return []; }
  if (!st.isDirectory()) return [];
  let children: import('fs').Dirent[];
  try { children = await readdir(full, { withFileTypes: true }); }
  catch { return []; }
  const out: TrashEntryDto[] = [];
  for (const child of children) {
    if (child.name.startsWith('.')) continue;
    const childRel = relPath ? `${relPath}/${child.name}` : child.name;
    const childFull = path.join(full, child.name);
    if (child.isDirectory()) {
      const sizeBytes = await recursiveSize(childFull);
      out.push({ originalPath: childRel, isDirectory: true, sizeBytes, mediaType: 'other' });
    } else if (child.isFile()) {
      let sz = 0;
      try { sz = (await stat(childFull)).size; } catch { /* keep 0 */ }
      out.push({
        originalPath: childRel,
        isDirectory: false,
        sizeBytes: sz,
        mediaType: mediaTypeFromPath(childRel, false),
      });
    }
  }
  // Folders first, then files; both alphabetically — matches the main DAM order.
  out.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.originalPath.localeCompare(b.originalPath, 'de', { sensitivity: 'base', numeric: true });
  });
  return out;
}

/** List every soft-delete batch surviving in `<categoryDir>/.trash/`. */
async function listTrashBatches(category: AssetCategory): Promise<TrashBatchDto[]> {
  const trashRoot = path.join(categoryDir(category), TRASH_DIRNAME);
  let entries: string[];
  try { entries = await readdir(trashRoot); }
  catch { return []; }
  const out: TrashBatchDto[] = [];
  for (const name of entries) {
    if (!TRASH_BATCH_ID_RE.test(name)) continue;
    const full = path.join(trashRoot, name);
    let st: import('fs').Stats;
    try { st = await stat(full); }
    catch { continue; }
    if (!st.isDirectory()) continue;
    // Opportunistic cleanup: collapse empty folder husks left over from earlier
    // partial restores (or empty-folder soft-deletes). The cleanup never touches
    // files, only empty dirs — so it's safe to run on every listing.
    await cleanupEmptyTrashDirs(full);
    // The batch dir itself may have just been removed by cleanup.
    if (!existsSync(full)) continue;
    const batchEntries = await listBatchEntries(category, name);
    if (batchEntries.length === 0) continue; // skip empty husks
    const createdAt = (lastDeletion && lastDeletion.batchId === name && lastDeletion.category === category)
      ? lastDeletion.createdAt
      : st.mtimeMs;
    const sizeBytes = batchEntries.reduce((a, b) => a + b.sizeBytes, 0);
    out.push({
      batchId: name,
      createdAt,
      expiresAt: createdAt + TRASH_TTL_MS,
      sizeBytes,
      isCurrent: !!(lastDeletion && lastDeletion.batchId === name && lastDeletion.category === category),
      entries: batchEntries,
    });
  }
  // Newest first so the UI shows fresh trash on top.
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/** Drop `originalPath`s from `lastDeletion` if they belong to the given batch; null when empty. */
function invalidateLastDeletionFor(category: AssetCategory, batchId: string, removed: Set<string>): void {
  if (!lastDeletion) return;
  if (lastDeletion.category !== category || lastDeletion.batchId !== batchId) return;
  lastDeletion.entries = lastDeletion.entries.filter(e => !removed.has(e.originalPath));
  if (lastDeletion.entries.length === 0) lastDeletion = null;
}

/**
 * Restore entries from a trash batch back to their originalPath. Items may be
 * top-level entries OR nested paths inside a soft-deleted folder — the only
 * constraint is that `<batchDir>/<item>` exists on disk. When `items` is
 * undefined, restore every top-level entry currently in the batch.
 *
 * Conflicts (a file/folder already at the destination) are left in trash and
 * reported via `conflicts`. After a successful restore the corresponding
 * `lastDeletion` entries are removed (or partial-restore-aware when the touched
 * `lastDeletion` entry was a folder containing only some of the restored
 * files).
 */
async function restoreTrashEntries(
  category: AssetCategory,
  batchId: string,
  items: string[] | undefined,
): Promise<{ restored: number; conflicts: string[] }> {
  const batchDir = trashBatchDir(category, batchId);
  let paths: string[];
  if (items === undefined) {
    paths = (await listBatchEntries(category, batchId)).map(e => e.originalPath);
  } else {
    paths = items;
  }
  const conflicts: string[] = [];
  const removedOriginals = new Set<string>();
  let restored = 0;
  for (const p of paths) {
    try { assertSafeTrashOriginalPath(p); }
    catch { conflicts.push(p); continue; }
    const trashPath = path.join(batchDir, p);
    const originalFull = path.join(categoryDir(category), p);
    if (!existsSync(trashPath)) {
      conflicts.push(`${p}: nicht im Papierkorb`);
      continue;
    }
    if (existsSync(originalFull)) {
      conflicts.push(p);
      continue;
    }
    try {
      await mkdir(path.dirname(originalFull), { recursive: true });
      await rename(trashPath, originalFull);
      restored++;
      removedOriginals.add(p);
      // Mirror the restore on NAS. Source is the NAS trash counterpart created
      // at delete time; if it doesn't exist (legacy local-only batch) the queue
      // tolerates ENOENT and the snapshot still gets upserted with the local
      // file's mtime so the next sync pushes it back to NAS.
      queueNasRestoreFromTrash(category, p, batchId);
    } catch (err) {
      conflicts.push(`${p}: ${(err as Error).message}`);
    }
  }
  // Bottom-up cleanup of intermediate directories left empty by partial
  // restores. CRITICAL: never use `rm(batchDir, { recursive: true })` here —
  // that destroys still-trashed files. Only `rmdir` empty dirs.
  await cleanupEmptyTrashDirs(batchDir);
  invalidateLastDeletionFor(category, batchId, removedOriginals);
  return { restored, conflicts };
}

/**
 * Recursively rmdir empty directories under `root`, then `root` itself if it
 * ended up empty. Files are never touched. Used after a partial-restore so the
 * batch dir collapses cleanly when its last entry is restored, while preserving
 * any sibling files that are still in trash.
 */
async function cleanupEmptyTrashDirs(root: string): Promise<void> {
  if (!existsSync(root)) return;
  let children: string[];
  try { children = await readdir(root); }
  catch { return; }
  for (const name of children) {
    const full = path.join(root, name);
    try {
      const st = await stat(full);
      if (st.isDirectory()) await cleanupEmptyTrashDirs(full);
    } catch { /* skip vanished */ }
  }
  try {
    const after = await readdir(root);
    if (after.length === 0) await rmdir(root);
  } catch { /* not empty or already gone */ }
}

/**
 * Permanently delete trash entries. `items` selects specific originalPaths;
 * omit to purge the whole batch. Omit both `batchId` and `items` to empty
 * every batch for the category.
 *
 * For audio entries we cascade to the derived cover at
 * `/images/Audio-Covers/{basename}.jpg` + sidecar meta, mirroring the
 * historical `purgeDeletionBatch` behaviour.
 */
async function purgeTrashEntries(
  category: AssetCategory,
  opts: { batchId?: string; items?: string[] },
): Promise<{ purged: number; batches: number }> {
  let purged = 0;
  let batches = 0;

  const purgeBatch = async (batchId: string, only?: string[]): Promise<void> => {
    if (!TRASH_BATCH_ID_RE.test(batchId)) return;
    const batchDir = trashBatchDir(category, batchId);
    // When `only` is undefined the caller wants the whole batch — synthesise the
    // top-level entry list. When `only` is provided, items may be nested paths
    // inside a soft-deleted folder; we just need the originalPath + a stat to
    // decide whether the audio-cover cascade applies.
    let targets: Array<{ originalPath: string; isDirectory: boolean }>;
    if (only === undefined) {
      const all = await listBatchEntries(category, batchId);
      targets = all.map(e => ({ originalPath: e.originalPath, isDirectory: e.isDirectory }));
    } else {
      targets = [];
      for (const p of only) {
        try { assertSafeTrashOriginalPath(p); } catch { continue; }
        const full = path.join(batchDir, p);
        try {
          const st = await stat(full);
          targets.push({ originalPath: p, isDirectory: st.isDirectory() });
        } catch { /* already gone — skip */ }
      }
    }
    const removedOriginals = new Set<string>();
    for (const entry of targets) {
      try { assertSafeTrashOriginalPath(entry.originalPath); } catch { continue; }
      const full = path.join(batchDir, entry.originalPath);
      try { await rm(full, { recursive: true, force: true }); }
      catch (err) { console.warn(`[trash] Failed to purge ${full}: ${(err as Error).message}`); }
      // The NAS counterpart already lives under NAS `.trash/<batchId>/` (placed
      // there by the DELETE handler's queueNasMoveToTrash). Target the trash
      // path directly — not the active path, which is empty by design.
      // ENOENT is tolerated for legacy local-only batches predating this fix.
      queueNasPurgeTrashEntry(category, batchId, entry.originalPath);
      if (category === 'audio' && !entry.isDirectory) {
        const imagesDir = categoryDir('images');
        const coverName = audioCoverFilename(path.basename(entry.originalPath));
        const coverFull = path.join(imagesDir, AUDIO_COVERS_SUBDIR, coverName);
        if (existsSync(coverFull)) {
          try { await rm(coverFull); queueNasDelete('images', `${AUDIO_COVERS_SUBDIR}/${coverName}`); }
          catch (err) { console.warn(`[trash] Failed to remove orphan cover ${coverName}: ${(err as Error).message}`); }
        }
        const ytFull = path.join(imagesDir, AUDIO_COVERS_SUBDIR, 'YouTube Thumbnails', coverName);
        if (existsSync(ytFull)) { try { await rm(ytFull); } catch { /* best-effort */ } }
        try { await deleteAudioCoverMeta(imagesDir, coverName); } catch { /* best-effort */ }
      }
      purged++;
      removedOriginals.add(entry.originalPath);
    }
    // Drop empty batch dir if nothing else survives.
    try {
      const survivors = await readdir(batchDir);
      if (survivors.length === 0) {
        await rm(batchDir, { recursive: true, force: true });
        // Mirror the cleanup on NAS so empty batch dirs don't accumulate there.
        queueNasPurgeTrashBatch(category, batchId);
        batches++;
      }
    } catch { /* already gone */ }
    invalidateLastDeletionFor(category, batchId, removedOriginals);
  };

  if (opts.batchId) {
    await purgeBatch(opts.batchId, opts.items);
  } else {
    const trashRoot = path.join(categoryDir(category), TRASH_DIRNAME);
    let names: string[];
    try { names = await readdir(trashRoot); } catch { names = []; }
    for (const name of names) await purgeBatch(name);
  }
  return { purged, batches };
}

/** Back-compat wrapper used by the DELETE handler when a new batch supersedes the old one. */
async function purgeDeletionBatch(batch: DeletionBatch): Promise<void> {
  await purgeTrashEntries(batch.category, { batchId: batch.batchId });
}

/** Sweep all `.trash/*` batches older than TRASH_TTL_MS. Runs once at startup. */
async function purgeStaleTrash(): Promise<void> {
  for (const category of ALLOWED_CATEGORIES) {
    const trashRoot = path.join(categoryDir(category), TRASH_DIRNAME);
    let entries: string[];
    try { entries = await readdir(trashRoot); }
    catch { continue; /* no trash for this category */ }
    for (const name of entries) {
      const full = path.join(trashRoot, name);
      try {
        const st = await stat(full);
        if (Date.now() - st.mtimeMs > TRASH_TTL_MS) {
          await rm(full, { recursive: true, force: true });
        }
      } catch { /* skip */ }
    }
  }
}

/**
 * NAS-side counterpart of `purgeStaleTrash`. The DAM-trash mirror lives at
 * `<NAS>/<category>/.trash/<batchId>/…`; without periodic GC the NAS share
 * accumulates batches indefinitely.
 *
 * Note: `pruneTrash` in `server/sync-safety.ts` only sweeps `<NAS_BASE>/.trash`
 * (base-level), not the per-category trash dirs created by the symmetric-trash
 * flow — this helper closes that gap.
 */
async function purgeStaleNasTrash(): Promise<void> {
  if (!isNasMounted()) return;
  for (const category of ALLOWED_CATEGORIES) {
    const trashRoot = path.join(NAS_BASE, category, TRASH_DIRNAME);
    let entries: string[];
    try { entries = await readdir(trashRoot); }
    catch { continue; }
    for (const name of entries) {
      const full = path.join(trashRoot, name);
      try {
        const st = await stat(full);
        if (Date.now() - st.mtimeMs > TRASH_TTL_MS) {
          await rm(full, { recursive: true, force: true });
        }
      } catch { /* skip */ }
    }
  }
}

// ── NAS Sync Queue ──
// All NAS operations are queued and processed sequentially with bandwidth throttling.

// `rel` / `relFrom` / `relTo` are the paths relative to LOCAL_ASSETS_BASE used to
// update the in-memory sync-state snapshot after the op succeeds. `null` means
// the op targets a path outside the asset tree (e.g. video cache mirroring) and
// must not touch the sync state.
type NasSyncOp =
  | { type: 'copy'; localPath: string; nasPath: string; rel: string | null; label: string }
  | { type: 'copy-to-local'; nasPath: string; localPath: string; rel: string | null; label: string }
  | { type: 'delete'; nasPath: string; rel: string | null; label: string }
  | { type: 'move'; nasFrom: string; nasTo: string; relFrom: string | null; relTo: string | null; label: string }
  | { type: 'mkdir'; nasPath: string; rel: string | null; label: string }
  // Symmetric DAM trash: move active NAS file into NAS `.trash/<batchId>/`.
  // Snapshot effect is `delete` of `relFrom` because the trash dest is dotfile-filtered
  // out of every walk and must NOT be tracked. See specs/sync-bidirectional.md
  // "Symmetric trash".
  | { type: 'move-to-trash'; nasFrom: string; nasTo: string; relFrom: string; label: string }
  // Inverse of `move-to-trash`. Snapshot effect is `upsert` of `relTo` using the
  // mtime of the (already-restored) local active file — keeps both sides aligned
  // even when the NAS rename happens after the local restore.
  | { type: 'restore-from-trash'; nasFrom: string; nasTo: string; relTo: string; localPath: string; label: string };

const nasSyncQueue: NasSyncOp[] = [];
let nasSyncRunning = false;

// In-memory sync-state snapshot. Mutated only after a NAS op succeeds, then
// persisted to both .sync-state.json files (debounced). Seeded lazily on first
// use from LOCAL_ASSETS_BASE so it reflects whatever the last successful sync
// wrote. Never rebuilt from a single-sided disk walk — doing so would claim the
// NAS is in sync when a queued op had failed, causing the next bidirectional
// sync to revert the user's action (rename/upload/delete).
let _syncStateSnapshot: SyncState | null = null;
function getSyncStateSnapshot(): SyncState {
  if (_syncStateSnapshot === null) {
    _syncStateSnapshot = readSyncState(LOCAL_ASSETS_BASE);
  }
  return _syncStateSnapshot;
}
function setSyncStateSnapshot(state: SyncState): void {
  // Defensive NFC normalization: a future caller might pass a snapshot built
  // from a non-normalized source (e.g. an in-memory snapshot taken before the
  // 2026-05-15 NFC fix). Re-normalize here so the snapshot is always NFC.
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.files)) {
    files[k.normalize('NFC')] = v;
  }
  _syncStateSnapshot = { lastSync: state.lastSync, files };
}

/** Apply a successful NAS op to the in-memory snapshot. No-op when `rel`/`relFrom`/`relTo`
 *  is null (op targets a path outside the asset tree, e.g. video cache mirroring). */
async function applyOpToSyncSnapshot(op: NasSyncOp): Promise<void> {
  const snap = getSyncStateSnapshot();
  switch (op.type) {
    case 'copy':
    case 'copy-to-local': {
      if (op.rel === null) return;
      try {
        const st = await stat(op.localPath);
        applySnapshotOp(snap, { type: 'upsert', rel: op.rel, mtime: st.mtime }, path.sep);
      } catch { /* local file gone — leave snapshot unchanged */ }
      return;
    }
    case 'delete':
      if (op.rel === null) return;
      applySnapshotOp(snap, { type: 'delete', rel: op.rel }, path.sep);
      return;
    case 'move':
      if (op.relFrom === null || op.relTo === null) return;
      applySnapshotOp(snap, { type: 'move', relFrom: op.relFrom, relTo: op.relTo }, path.sep);
      return;
    case 'move-to-trash':
      // Trash dest is dotfile-filtered out of every walk — drop the entry instead of moving it.
      applySnapshotOp(snap, { type: 'delete', rel: op.relFrom }, path.sep);
      return;
    case 'restore-from-trash': {
      // Source is in `.trash/` (untracked). Mirror the (already-restored) local file's mtime
      // so a subsequent rescan reports both sides in sync. If the local restore failed
      // upstream the file won't exist — leave the snapshot alone.
      try {
        const st = await stat(op.localPath);
        applySnapshotOp(snap, { type: 'upsert', rel: op.relTo, mtime: st.mtime }, path.sep);
      } catch { /* local file gone — leave snapshot unchanged */ }
      return;
    }
    case 'mkdir':
      return;
  }
}

// Server-side stream tracking (for throttling NAS sync when video is playing)
let _serverStreamActive = 0;
function isServerStreamActive(): boolean { return _serverStreamActive > 0; }

const NAS_SYNC_THROTTLED_SPEED = 2 * 1024 * 1024; // 2 MB/s when video is playing
const NAS_SYNC_CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB chunks

// Stats for system tab
const nasSyncStats = {
  status: 'idle' as 'idle' | 'syncing' | 'error',
  currentOp: null as string | null,
  throttled: false,
  bytesSynced: 0,
  startupSync: null as { phase: 'scanning' | 'syncing' | 'done'; total: number; done: number } | null,
  lastRescanAt: null as number | null,
};

/**
 * Atomic file copy via `.tmp + rename`. Crash-safe: a partial copy leaves the
 * destination either at the OLD content (rename never ran) or the NEW content
 * (rename completed) — never a truncated half-written file. Used for pulls
 * and copy-to-local ops so the DAM and streaming layers can never serve a
 * mid-write JPEG/MP3 with corrupted bytes (pre-fix: a `copyFile` interrupted
 * by SIGKILL or NAS drop left exactly that).
 */
async function atomicCopyFile(src: string, dest: string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  try {
    await copyFile(src, tmp);
    await rename(tmp, dest);
  } catch (err) {
    await unlink(tmp).catch(() => { /* tmp may not exist */ });
    throw err;
  }
}

/**
 * Copy a file to NAS with bandwidth throttling when video is playing.
 * Uses atomic write (.tmp + rename) for crash safety.
 */
async function throttledCopyFile(src: string, dest: string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  const tmpDest = dest + '.tmp';

  const srcStat = await stat(src);
  const fileSize = srcStat.size;

  // Small files or no throttling needed: direct copy
  if (fileSize <= NAS_SYNC_CHUNK_SIZE || !isServerStreamActive()) {
    nasSyncStats.throttled = false;
    await copyFile(src, tmpDest);
    await rename(tmpDest, dest);
    nasSyncStats.bytesSynced += fileSize;
    return;
  }

  // Large files during streaming: chunked copy with throttling
  nasSyncStats.throttled = true;
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(src, { highWaterMark: NAS_SYNC_CHUNK_SIZE });
    const ws = createWriteStream(tmpDest);
    let bytesWritten = 0;

    rs.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const chunkStart = Date.now();
      const canContinue = ws.write(buf);
      bytesWritten += buf.length;
      nasSyncStats.bytesSynced += buf.length;

      if (isServerStreamActive() && bytesWritten < fileSize) {
        rs.pause();
        const elapsed = (Date.now() - chunkStart) / 1000;
        const targetTime = buf.length / NAS_SYNC_THROTTLED_SPEED;
        const delay = Math.max(0, (targetTime - elapsed) * 1000);
        nasSyncStats.throttled = true;
        setTimeout(() => {
          nasSyncStats.throttled = isServerStreamActive();
          rs.resume();
        }, delay);
      } else {
        nasSyncStats.throttled = false;
        if (!canContinue) {
          rs.pause();
          ws.once('drain', () => rs.resume());
        }
      }
    });

    rs.on('end', () => ws.end());
    ws.on('finish', resolve);
    rs.on('error', reject);
    ws.on('error', reject);
  });

  await rename(tmpDest, dest);
}

/**
 * Enqueue a NAS sync operation. Processed sequentially in background.
 *
 * NFC-normalize every relative path on the op before enqueuing. Callers
 * (queueNasCopy / Delete / Move / MoveCross / Mkdir) build `rel` paths from
 * route params, multipart filenames, and other request-supplied strings. If
 * any of those arrive in NFD form, the snapshot would store an NFD key, the
 * next filesystem walk would return NFC, and `computeSyncOps` would misread
 * the mismatch as deletion intent (the 2026-05-14 incident root cause).
 * Normalizing at this chokepoint protects every admin DAM op without having
 * to remember to normalize at each call site.
 */
function queueNasSync(op: NasSyncOp): void {
  if (!isNasMounted()) return;
  if ('rel' in op && op.rel !== null) op.rel = op.rel.normalize('NFC');
  if ('relFrom' in op && op.relFrom !== null) op.relFrom = op.relFrom.normalize('NFC');
  if ('relTo' in op && op.relTo !== null) op.relTo = op.relTo.normalize('NFC');
  nasSyncQueue.push(op);
  // No hard cap — ops are bounded by admin actions and must not be dropped —
  // but surface unbounded growth (e.g. NAS offline for a long session).
  if (nasSyncQueue.length > 0 && nasSyncQueue.length % 500 === 0) {
    console.warn(`[nas-sync] queue has grown to ${nasSyncQueue.length} pending op(s) — is the NAS reachable?`);
  }
  processNasSyncQueue();
}

/**
 * Process the NAS sync queue one operation at a time.
 */
async function processNasSyncQueue(): Promise<void> {
  if (nasSyncRunning || nasSyncQueue.length === 0) return;
  nasSyncRunning = true;
  nasSyncStats.status = 'syncing';

  while (nasSyncQueue.length > 0) {
    if (!isNasMounted()) {
      console.warn('[nas-sync] NAS disconnected, pausing queue');
      break;
    }

    const op = nasSyncQueue[0];
    nasSyncStats.currentOp = op.label;
    const taskId = bgTaskStart('nas-sync', op.label);

    try {
      switch (op.type) {
        case 'copy':
          await throttledCopyFile(op.localPath, op.nasPath);
          break;
        case 'copy-to-local':
          await atomicCopyFile(op.nasPath, op.localPath);
          break;
        case 'delete':
          // Surface every rm failure except ENOENT (already gone = success). The
          // previous `.catch(() => {})` swallowed permission errors, EBUSY, NAS
          // glitches, etc., letting applyOpToSyncSnapshot drop the entry while
          // the NAS file still existed — next sync then pulled it back.
          try {
            await rm(op.nasPath, { recursive: true, force: true });
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
          }
          break;
        case 'move':
          await mkdir(path.dirname(op.nasTo), { recursive: true });
          await rename(op.nasFrom, op.nasTo).catch(async () => {
            // Cross-filesystem: copy + delete (still atomic on the destination side via atomicCopyFile)
            await atomicCopyFile(op.nasFrom, op.nasTo);
            await unlink(op.nasFrom).catch(() => {});
          });
          break;
        case 'move-to-trash':
        case 'restore-from-trash':
          await mkdir(path.dirname(op.nasTo), { recursive: true });
          try {
            await rename(op.nasFrom, op.nasTo);
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
              // Source already gone — idempotent success. Covers legacy local-only
              // trash batches (no NAS counterpart) and queue retries after a partial
              // failure. The snapshot still gets the move-to-trash/restore-from-trash
              // effect applied below.
              break;
            }
            if (code === 'EXDEV') {
              // Cross-filesystem fallback. Note that SMB shares occasionally surface
              // this when the rename crosses a junction.
              await atomicCopyFile(op.nasFrom, op.nasTo);
              await unlink(op.nasFrom);
              break;
            }
            throw err;
          }
          break;
        case 'mkdir':
          await mkdir(op.nasPath, { recursive: true });
          break;
      }
      await applyOpToSyncSnapshot(op);
      bgTaskDone(taskId);
      nasSyncQueue.shift();
    } catch (err) {
      bgTaskError(taskId, (err as Error).message);
      console.warn(`[nas-sync] Failed: ${op.label} — ${(err as Error).message}`);
      nasSyncQueue.shift(); // Don't block queue on persistent failures
    }
  }

  nasSyncStats.currentOp = null;
  nasSyncStats.throttled = false;
  nasSyncStats.status = nasSyncQueue.length > 0 ? 'error' : 'idle';
  nasSyncRunning = false;

  // Debounced sync state save
  debouncedSaveSyncState();
}

// ── Retry NAS sync queue periodically (when NAS reconnects) ──
setInterval(() => {
  if (!nasSyncRunning && nasSyncQueue.length > 0 && isNasMounted()) {
    console.log(`[nas-sync] Retrying ${nasSyncQueue.length} queued operation(s)`);
    processNasSyncQueue();
  }
}, 30_000);

// ── Sync State (bidirectional sync tracking) ──

const SYNC_STATE_FILE = '.sync-state.json';

function readSyncState(baseDir: string): SyncState {
  const p = path.join(baseDir, SYNC_STATE_FILE);
  if (!existsSync(p)) return { lastSync: '', files: {} };
  return parseSyncState(readFileSync(p, 'utf8'));
}

function writeSyncState(baseDir: string, state: SyncState): void {
  // Atomic write: a crash mid-write leaves the OLD state intact, not a
  // truncated JSON that `parseSyncState` falls back to {} for. An empty prev
  // state disables Layer 2's loss-ratio veto (denominator is 0 → no veto
  // fires), which would re-expose the 2026-05-14 mass-delete scenario after
  // any process crash during a debouncedSaveSyncState write.
  const dest = path.join(baseDir, SYNC_STATE_FILE);
  const tmp = dest + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    renameSync(tmp, dest);
  } catch (err) {
    console.warn(`[sync-state] Failed to write ${baseDir}: ${(err as Error).message}`);
    try { unlinkSync(tmp); } catch { /* tmp may not exist */ }
  }
}

// Debounced sync state persistence. The snapshot is mutated per successful op
// by `applyOpToSyncSnapshot`; this just batches writes to disk.
let _syncStateTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSaveSyncState(): void {
  if (_syncStateTimer) clearTimeout(_syncStateTimer);
  _syncStateTimer = setTimeout(() => {
    _syncStateTimer = null;
    if (!isNasMounted()) return;
    const snap = getSyncStateSnapshot();
    snap.lastSync = new Date().toISOString();
    writeSyncState(LOCAL_ASSETS_BASE, snap);
    writeSyncState(NAS_BASE, snap);
  }, 2000);
}

const ASSET_FOLDERS = ['audio', 'images', 'background-music', 'videos'] as const;

/**
 * Startup bidirectional sync: compare local ↔ NAS using .sync-state.json.
 * Runs async — server is immediately usable.
 */
async function startupSync(): Promise<void> {
  if (!isNasMounted()) {
    console.log('[startup-sync] NAS not mounted, skipping sync');
    return;
  }

  // Defensive: if admin DAM ops arrived in the brief window between server
  // initialization and this call, let the queue drain first. startupSync does
  // its own NAS I/O (not via the queue), so racing the two writers against the
  // same file is unsafe. Mirrors the `periodicRescan` guard.
  if (nasSyncQueue.length > 0 || nasSyncRunning) {
    console.log(
      `[startup-sync] deferring — NAS queue has ${nasSyncQueue.length} pending op(s); retrying in 30s`,
    );
    setTimeout(() => { startupSync().catch(() => { /* logged inside */ }); }, 30_000);
    return;
  }

  const taskId = bgTaskStart('startup-sync', 'NAS-Sync: Starte…');
  nasSyncStats.startupSync = { phase: 'scanning', total: 0, done: 0 };

  try {
    pruneTrash(LOCAL_ASSETS_BASE);
    pruneTrash(NAS_BASE);
    // Per-category DAM-trash sweep (symmetric mirror of `purgeStaleTrash`).
    purgeStaleNasTrash().catch(err => console.warn(`[startup-sync] NAS trash sweep failed: ${(err as Error).message}`));
    const runId = makeRunId();

    const localState = readSyncState(LOCAL_ASSETS_BASE);
    const nasState = readSyncState(NAS_BASE);
    const prevFiles = resolvePrevFiles(localState, nasState);

    const [localFiles, nasFiles, trashedRels] = await Promise.all([
      collectFileMetadata(LOCAL_ASSETS_BASE, ASSET_FOLDERS),
      collectFileMetadata(NAS_BASE, ASSET_FOLDERS),
      collectTrashedRelPaths(LOCAL_ASSETS_BASE, ASSET_FOLDERS),
    ]);

    const rawOps = computeSyncOps(localFiles, nasFiles, prevFiles);

    // Layer 2 — per-folder loss-ratio veto (warns and continues with filtered ops).
    // Files in `trashedRels` are excluded from the local-loss count: the DAM
    // moved them to local `.trash/`, so the active-path walk doesn't see them,
    // but that's deliberate intent rather than data loss.
    const safe = applyDeletionSafety(rawOps, localFiles, nasFiles, prevFiles, trashedRels);
    for (const v of safe.vetoes) {
      // v.side names the target side of the stripped op (delete-local → 'local').
      // The SUSPECT (lossy) side is the opposite: a stripped delete-local means NAS lost files.
      const skipped = `delete-${v.side}`;
      const suspectSide = v.side === 'local' ? 'NAS' : 'local';
      console.warn(
        `[startup-sync] safety: "${v.folder}/" lost ${(v.lossRatio * 100).toFixed(1)}% of prev-state files on ${suspectSide} — ` +
        `skipping ${v.count} ${skipped} op(s). Probable cause: NAS data loss, partial mount, or failed prior op.`,
      );
    }

    // Layer 3 — bulk-delete cap (aborts entire sync). Trash-backed delete-nas
    // ops (recovery from a failed DAM move-to-trash queue op) are excluded
    // from the cap — they're legitimate user intent, just running through the
    // recovery path instead of the DAM's fast path.
    const bulk = checkBulkDelete(safe.ops, localFiles, nasFiles, trashedRels);
    if (!bulk.ok) {
      console.error(
        `[startup-sync] safety: ${bulk.reason} ` +
        `(tracked: ${bulk.trackedFiles}, threshold: ${bulk.threshold})`,
      );
      bgTaskError(
        taskId,
        `${bulk.totalDeletes} Löschungen (Limit ${bulk.threshold}) — Sync abgebrochen.`,
      );
      nasSyncStats.startupSync = null;
      return; // abort entire sync — no push, no pull, no delete
    }

    const ops: SyncOp[] = safe.ops;

    nasSyncStats.startupSync = { phase: 'syncing', total: ops.length, done: 0 };
    if (ops.length > 0) {
      console.log(`[startup-sync] ${ops.length} file(s) to sync`);
    }

    // Track failed ops so the new state omits them. A failed push/pull must
    // NOT be recorded as "in sync" — otherwise the next run reads the file as
    // "in prev + missing on one side" and trashes it (root cause of the
    // 2026-05-14 incident).
    const failedOps = new Set<string>();

    for (const op of ops) {
      const localPath = path.join(LOCAL_ASSETS_BASE, op.rel);
      const nasPath = path.join(NAS_BASE, op.rel);

      try {
        switch (op.action) {
          case 'push':
            console.log(`[startup-sync]   → NAS: ${op.rel}`);
            await throttledCopyFile(localPath, nasPath);
            break;
          case 'pull':
            console.log(`[startup-sync]   ← Local: ${op.rel}`);
            await atomicCopyFile(nasPath, localPath);
            break;
          case 'delete-local':
            console.log(`[startup-sync]   ✗ trash local: ${op.rel}`);
            softDelete(LOCAL_ASSETS_BASE, op.rel, runId);
            break;
          case 'delete-nas':
            console.log(`[startup-sync]   ✗ trash NAS: ${op.rel}`);
            softDelete(NAS_BASE, op.rel, runId);
            break;
        }
      } catch (err) {
        console.warn(`[startup-sync] Failed: ${op.action} ${op.rel} — ${(err as Error).message}`);
        failedOps.add(op.rel);
      }

      nasSyncStats.startupSync!.done++;
      const t = backgroundTasks.get(taskId);
      if (t) t.detail = `${nasSyncStats.startupSync!.done}/${nasSyncStats.startupSync!.total} Dateien`;
    }

    // Build new state AFTER ops have run so failedOps reflects actual results.
    const newState = buildNewSyncState(localFiles, nasFiles, ops, failedOps);

    // Write updated sync state to both sides
    writeSyncState(LOCAL_ASSETS_BASE, newState);
    writeSyncState(NAS_BASE, newState);
    setSyncStateSnapshot(newState);

    nasSyncStats.startupSync = { phase: 'done', total: ops.length, done: ops.length };
    nasSyncStats.lastRescanAt = Date.now();
    bgTaskDone(taskId);
    if (ops.length > 0) {
      console.log(`[startup-sync] Done: ${ops.length} file(s) synced`);
    } else {
      console.log('[startup-sync] Everything in sync');
    }
  } catch (err) {
    bgTaskError(taskId, (err as Error).message);
    console.error(`[startup-sync] Error: ${(err as Error).message}`);
    nasSyncStats.startupSync = null;
  }
}

/**
 * Periodic filesystem rescan: discover files written outside the server
 * (e.g., by bandle-sync.cjs) and sync them with NAS.
 */
let rescanRunning = false;
async function periodicRescan(): Promise<void> {
  if (rescanRunning || !isNasMounted()) return;
  // Skip when the per-op NAS queue still has work pending. Admin DAM ops
  // (upload, rename, move, delete) all enqueue NAS work and only update
  // the sync-state snapshot after success — running a rescan mid-flight
  // sees inconsistent state and can trash the file the DAM is still trying
  // to copy. Wait until the queue drains.
  if (nasSyncQueue.length > 0 || nasSyncRunning) {
    console.log(
      `[periodic-rescan] skipped — NAS queue has ${nasSyncQueue.length} pending op(s), ` +
      `will retry on next interval`,
    );
    return;
  }
  rescanRunning = true;

  try {
    pruneTrash(LOCAL_ASSETS_BASE);
    pruneTrash(NAS_BASE);
    purgeStaleNasTrash().catch(err => console.warn(`[periodic-rescan] NAS trash sweep failed: ${(err as Error).message}`));
    const runId = makeRunId();

    const localState = readSyncState(LOCAL_ASSETS_BASE);
    const nasState = readSyncState(NAS_BASE);
    const prevFiles = resolvePrevFiles(localState, nasState);

    const [localFiles, nasFiles, trashedRels] = await Promise.all([
      collectFileMetadata(LOCAL_ASSETS_BASE, ASSET_FOLDERS),
      collectFileMetadata(NAS_BASE, ASSET_FOLDERS),
      collectTrashedRelPaths(LOCAL_ASSETS_BASE, ASSET_FOLDERS),
    ]);

    const rawOps = computeSyncOps(localFiles, nasFiles, prevFiles);
    nasSyncStats.lastRescanAt = Date.now();

    if (rawOps.length === 0) return;

    // Layer 2 — per-folder loss-ratio veto (excludes trash-intent files from
    // local-loss accounting; see startupSync above for rationale).
    const safe = applyDeletionSafety(rawOps, localFiles, nasFiles, prevFiles, trashedRels);
    for (const v of safe.vetoes) {
      // v.side names the target side of the stripped op (delete-local → 'local').
      // The SUSPECT (lossy) side is the opposite: a stripped delete-local means NAS lost files.
      const skipped = `delete-${v.side}`;
      const suspectSide = v.side === 'local' ? 'NAS' : 'local';
      console.warn(
        `[periodic-rescan] safety: "${v.folder}/" lost ${(v.lossRatio * 100).toFixed(1)}% of prev-state files on ${suspectSide} — ` +
        `skipping ${v.count} ${skipped} op(s). Probable cause: NAS data loss, partial mount, or failed prior op.`,
      );
    }

    // Layer 3 — bulk-delete cap (excludes trash-intent delete-nas ops).
    const bulk = checkBulkDelete(safe.ops, localFiles, nasFiles, trashedRels);
    if (!bulk.ok) {
      console.error(
        `[periodic-rescan] safety: ${bulk.reason} ` +
        `(tracked: ${bulk.trackedFiles}, threshold: ${bulk.threshold})`,
      );
      const taskId = bgTaskStart('nas-sync', 'NAS-Sync abgebrochen');
      bgTaskError(
        taskId,
        `${bulk.totalDeletes} Löschungen (Limit ${bulk.threshold}) — Sync abgebrochen.`,
      );
      return; // abort entire sync
    }

    const ops: SyncOp[] = safe.ops;
    if (ops.length === 0) return;

    console.log(`[periodic-rescan] Found ${ops.length} file(s) to sync`);
    const taskId = bgTaskStart('nas-sync', `Rescan: ${ops.length} Dateien`);

    // Track failed ops so the new state omits them. A failed push/pull must
    // NOT be recorded as "in sync" — otherwise the next run reads the file as
    // "in prev + missing on one side" and trashes it (root cause of the
    // 2026-05-14 incident).
    const failedOps = new Set<string>();

    for (const op of ops) {
      const localPath = path.join(LOCAL_ASSETS_BASE, op.rel);
      const nasPath = path.join(NAS_BASE, op.rel);

      try {
        switch (op.action) {
          case 'push':
            console.log(`[periodic-rescan]   → NAS: ${op.rel}`);
            await mkdir(path.dirname(nasPath), { recursive: true });
            await throttledCopyFile(localPath, nasPath);
            break;
          case 'pull':
            console.log(`[periodic-rescan]   ← Local: ${op.rel}`);
            await atomicCopyFile(nasPath, localPath);
            break;
          case 'delete-local':
            console.log(`[periodic-rescan]   ✗ trash local: ${op.rel}`);
            softDelete(LOCAL_ASSETS_BASE, op.rel, runId);
            break;
          case 'delete-nas':
            console.log(`[periodic-rescan]   ✗ trash NAS: ${op.rel}`);
            softDelete(NAS_BASE, op.rel, runId);
            break;
        }
      } catch (err) {
        console.warn(`[periodic-rescan] Failed: ${op.action} ${op.rel} — ${(err as Error).message}`);
        failedOps.add(op.rel);
      }
    }

    // Build new state AFTER ops have run so failedOps reflects actual results.
    const newState = buildNewSyncState(localFiles, nasFiles, ops, failedOps);

    writeSyncState(LOCAL_ASSETS_BASE, newState);
    writeSyncState(NAS_BASE, newState);
    setSyncStateSnapshot(newState);
    bgTaskDone(taskId);
    console.log(`[periodic-rescan] Done: ${ops.length} file(s) synced`);
  } catch (err) {
    console.warn(`[periodic-rescan] Error: ${(err as Error).message}`);
  } finally {
    rescanRunning = false;
  }
}

// ── Periodic filesystem rescan (every 5 minutes) ──
setInterval(() => { periodicRescan(); }, 300_000);

/**
 * Helper: queue a copy from local to NAS for an asset file.
 */
function queueNasCopy(category: string, relPath: string): void {
  const localPath = path.join(LOCAL_ASSETS_BASE, category, relPath);
  const nasPath = path.join(NAS_BASE, category, relPath);
  queueNasSync({ type: 'copy', localPath, nasPath, rel: path.join(category, relPath), label: `→ NAS: ${category}/${relPath}` });
}

/**
 * Helper: queue a deletion on NAS for an asset file.
 */
function queueNasDelete(category: string, relPath: string): void {
  const nasPath = path.join(NAS_BASE, category, relPath);
  queueNasSync({ type: 'delete', nasPath, rel: path.join(category, relPath), label: `✗ NAS: ${category}/${relPath}` });
}

/**
 * Helper: queue a move/rename on NAS.
 */
function queueNasMove(category: string, from: string, to: string): void {
  const nasFrom = path.join(NAS_BASE, category, from);
  const nasTo = path.join(NAS_BASE, category, to);
  queueNasSync({ type: 'move', nasFrom, nasTo, relFrom: path.join(category, from), relTo: path.join(category, to), label: `NAS: ${from} → ${to}` });
}

function queueNasMoveCross(
  fromCategory: string, from: string,
  toCategory: string, to: string,
): void {
  const nasFrom = path.join(NAS_BASE, fromCategory, from);
  const nasTo = path.join(NAS_BASE, toCategory, to);
  queueNasSync({
    type: 'move', nasFrom, nasTo,
    relFrom: path.join(fromCategory, from),
    relTo: path.join(toCategory, to),
    label: `NAS: ${fromCategory}/${from} → ${toCategory}/${to}`,
  });
}

/**
 * Helper: queue a mkdir on NAS.
 */
function queueNasMkdir(category: string, folderPath: string): void {
  const nasPath = path.join(NAS_BASE, category, folderPath);
  queueNasSync({ type: 'mkdir', nasPath, rel: null, label: `NAS mkdir: ${category}/${folderPath}` });
}

/**
 * Soft-delete the NAS-side counterpart of a DAM-trashed file: rename
 * `<NAS>/<category>/<relPath>` → `<NAS>/<category>/.trash/<batchId>/<relPath>`.
 *
 * Mirrors the local rename done by the DELETE handler so both sides leave the
 * active path at the same moment. `.trash/` is dotfile-filtered by every walk,
 * so the snapshot drops `<category>/<relPath>` — no asymmetric window for
 * `computeSyncOps` to misread. See specs/sync-bidirectional.md "Symmetric trash".
 */
function queueNasMoveToTrash(category: string, relPath: string, batchId: string): void {
  const nasFrom = path.join(NAS_BASE, category, relPath);
  const nasTo = path.join(NAS_BASE, category, TRASH_DIRNAME, batchId, relPath);
  queueNasSync({
    type: 'move-to-trash',
    nasFrom,
    nasTo,
    relFrom: path.join(category, relPath),
    label: `→ NAS .trash/${batchId}: ${category}/${relPath}`,
  });
}

/** Inverse of `queueNasMoveToTrash` — used by undo / Papierkorb restore. */
function queueNasRestoreFromTrash(category: string, relPath: string, batchId: string): void {
  const nasFrom = path.join(NAS_BASE, category, TRASH_DIRNAME, batchId, relPath);
  const nasTo = path.join(NAS_BASE, category, relPath);
  const localPath = path.join(LOCAL_ASSETS_BASE, category, relPath);
  queueNasSync({
    type: 'restore-from-trash',
    nasFrom,
    nasTo,
    relTo: path.join(category, relPath),
    localPath,
    label: `← NAS .trash/${batchId}: ${category}/${relPath}`,
  });
}

/**
 * Permanently delete a single entry from the NAS-side trash mirror. `rel: null`
 * because the entry already lives under `.trash/` (untracked) — the snapshot
 * has nothing to update. ENOENT is tolerated by the queue switch, which covers
 * legacy local-only trash batches whose NAS counterpart was never created.
 */
function queueNasPurgeTrashEntry(category: string, batchId: string, relPath: string): void {
  const nasPath = path.join(NAS_BASE, category, TRASH_DIRNAME, batchId, relPath);
  queueNasSync({
    type: 'delete',
    nasPath,
    rel: null,
    label: `✗ NAS .trash/${batchId}: ${category}/${relPath}`,
  });
}

/** Drop an empty NAS trash batch dir. Idempotent — ENOENT is success. */
function queueNasPurgeTrashBatch(category: string, batchId: string): void {
  const nasPath = path.join(NAS_BASE, category, TRASH_DIRNAME, batchId);
  queueNasSync({
    type: 'delete',
    nasPath,
    rel: null,
    label: `✗ NAS .trash/${batchId}: ${category}`,
  });
}

// In production, serve the built React app
const clientDist = path.join(ROOT_DIR, 'dist', 'client');
if (existsSync(clientDist)) {
  // Root and legacy frontend paths redirect into /show — the three PWA
  // scopes must be disjoint (`/show/`, `/admin/`, `/gamemaster/`) or Chrome
  // treats them as one installable app. Handled explicitly here so it runs
  // before express.static instead of relying on the wildcard SPA fallback.
  app.get('/', (_req, res) => {
    res.redirect(302, '/show/');
  });

  // PWA assets must not be aggressively cached, or service worker updates
  // won't reach clients. Manifests need a specific Content-Type so Chrome/
  // Safari recognize them as installable.
  app.use((req, res, next) => {
    if (req.path.endsWith('/sw.js') || req.path.endsWith('/registerSW.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
    if (req.path.endsWith('/manifest.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
    next();
  });
  app.use(express.static(clientDist));
}

// Serve static asset directories — prefer local copy when it matches NAS (saves bandwidth).
// When NAS is mounted, check if the local copy has the same file size (same-content proxy).
// If sizes match, serve from local-assets; otherwise fall through to NAS.
// When NAS is not mounted, only local-assets is tried.

// Fix MIME type for .m4v: browsers need video/mp4 (not video/x-m4v) for proper HDR tone mapping
const staticOptions: import('serve-static').ServeStaticOptions = {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.m4v')) {
      res.setHeader('Content-Type', 'video/mp4');
    }
    // Audio covers can be overridden in place (Cover wechseln / iTunes-Cover
    // laden in the DAM) — their path stays the same but the bytes change, so
    // browsers must revalidate on every use. express.static sets ETag +
    // Last-Modified, so unchanged files respond 304 (same cost as a cache
    // hit). See specs/audio-cover-override.md.
    if (filePath.includes(`/${AUDIO_COVERS_SUBDIR}/`) && /\.(jpe?g|png|webp|gif)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    // Let browsers cache images/audio for 5 min without revalidation -- avoids
    // full re-fetch of DAM poster thumbnails on every tab switch. Poster
    // regeneration ("Filmcover laden") is cache-busted client-side via ?v=
    // (see AssetsTab.tsx VideoThumb). Raw /videos/ files are intentionally
    // excluded: they're large, served via Range, and the dedicated video-cache
    // endpoints (/videos-compressed/, /videos-sdr/) set their
    // own Cache-Control already.
    if (/\.(jpg|jpeg|png|webp|gif|svg|mp3|m4a|wav|ogg)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  },
};

// Block access to backup/ subdirectories (created by audio normalization)
app.use((req, res, next) => {
  if (/(^|\/)backup(\/|$)/.test(req.path)) return res.status(404).end();
  next();
});

// Local-first: serve all assets from local-assets. NAS is synced in background.
for (const folder of ['images', 'audio', 'background-music', 'videos']) {
  const localDir = path.join(LOCAL_ASSETS_BASE, folder);
  app.use(`/${folder}`, express.static(localDir, staticOptions));
}

import { spawn, execFile } from 'child_process';
import sharp from 'sharp';
import ffmpegStaticPath from 'ffmpeg-static';
import { getCacheMode, setCacheMode, onCacheModeChange, getRepriceArgs, type CacheMode } from './encoding-prefs.js';
const FFMPEG_BIN = ffmpegStaticPath ?? 'ffmpeg';

// Shared concurrency limiter for ALL background ffmpeg encodes (segment cache,
// HDR→SDR warmup, …). Mode-aware:
//   - balanced (default): 1 — combined with utility QoS / nice 19 in
//     bgProcessPrefix(), guarantees file serving is never blocked during a show.
//   - max (operator opt-in): 4 — parallel encodes at full priority for prep windows.
// See specs/server-asset-priority.md.
const BG_ENCODE_CONCURRENCY_BALANCED = 1;
const BG_ENCODE_CONCURRENCY_MAX = 4;
function getBgEncodeConcurrency(): number {
  return getCacheMode() === 'max' ? BG_ENCODE_CONCURRENCY_MAX : BG_ENCODE_CONCURRENCY_BALANCED;
}
let _bgEncodeRunning = 0;
const _bgEncodeQueue: Array<() => void> = [];
function bgEncodeAcquire(): Promise<void> {
  if (_bgEncodeRunning < getBgEncodeConcurrency()) { _bgEncodeRunning++; return Promise.resolve(); }
  return new Promise(resolve => _bgEncodeQueue.push(resolve));
}
function bgEncodeRelease(): void {
  // Use the current cap so balanced→max mid-queue lets queued items drain to the new cap.
  if (_bgEncodeQueue.length > 0 && _bgEncodeRunning <= getBgEncodeConcurrency()) {
    const next = _bgEncodeQueue.shift();
    if (next) { next(); return; }
  }
  _bgEncodeRunning--;
  // Drain any extra queued items if the cap has been raised since they were enqueued.
  while (_bgEncodeRunning < getBgEncodeConcurrency() && _bgEncodeQueue.length > 0) {
    const next = _bgEncodeQueue.shift();
    if (next) { _bgEncodeRunning++; next(); }
  }
}
/** Acquire an encode slot on behalf of a bgTask, flipping it to `running` the
 *  instant the slot is obtained. The task must have been created via
 *  `bgTaskQueue` — if it's already running, the mark is a no-op (safe). */
async function bgEncodeAcquireForTask(taskId: string | undefined): Promise<void> {
  await bgEncodeAcquire();
  if (taskId) bgTaskMarkRunning(taskId);
}

/** Platform-specific prefix that demotes a CPU-heavy process to "use whatever cores
 *  the foreground isn't using right now". Mode-aware:
 *   - In max mode: returns [] — no demotion, ffmpeg runs at full user-initiated priority.
 *   - In balanced mode:
 *     - Linux: `nice -n 19` (CFS weight 7 vs 1024 at nice 0). The kernel scheduler
 *       gives the process essentially all idle CPU but preempts it the moment a
 *       nice-0 process needs cycles. Threads can land on any core.
 *     - macOS: `taskpolicy -c utility`. Utility QoS allows BOTH P-cores and E-cores
 *       (unlike background QoS, which clamps to E-cores only — too slow on Apple
 *       Silicon when the system is idle). Under contention, the Mach scheduler still
 *       preempts utility work in favor of user-initiated work (Express). Utility QoS
 *       does not imply I/O throttling.
 *     - Windows: no demotion (no equivalent without elevated rights).
 *
 *  We deliberately do NOT use `-c background` (macOS) or `ionice -c 3` (Linux) —
 *  both make the process unable to use P-cores / throttle disk I/O, which makes
 *  background work crawl even on an idle system.
 */
function bgProcessPrefix(): string[] {
  if (getCacheMode() === 'max') return [];
  if (process.platform === 'darwin') return ['taskpolicy', '-c', 'utility'];
  if (process.platform === 'linux') return ['nice', '-n', '19'];
  return [];
}

/** Active background ffmpeg PIDs. Populated by `spawnBackgroundFfmpeg()` and
 *  drained in the child's 'close' handler. Read by `reapplyBgPriority()` when the
 *  operator flips the cache mode so already-running encodes pick up the new
 *  priority without waiting to finish. */
const _bgFfmpegPids = new Set<number>();

/** Re-apply the priority of every in-flight background ffmpeg to match the given
 *  mode. Called on every cache-mode change. Failures (process exited mid-flip,
 *  permission denied, etc.) are logged and ignored — the worst case is one PID
 *  keeps its old priority until it finishes naturally. */
function reapplyBgPriority(mode: CacheMode): void {
  if (_bgFfmpegPids.size === 0) return;
  const args = getRepriceArgs(mode);
  if (!args) return; // windows / unsupported — nothing to do
  for (const pid of _bgFfmpegPids) {
    execFile(args[0], [...args.slice(1), String(pid)], (err) => {
      if (err) {
        // Process may have exited between iteration and the syscall — harmless.
        console.warn(`[encoding-prefs] failed to reprice pid ${pid} to ${mode}: ${err.message}`);
      }
    });
  }
}

onCacheModeChange(reapplyBgPriority);

/** Spawn ffmpeg for background work (cache generation, warmup, normalization).
 *  CPU demotion is applied via `bgProcessPrefix()` so file serving during a live
 *  show pre-empts the encode. No `-threads` cap: we want ffmpeg to use every
 *  available core when the system is idle, and rely on the kernel scheduler to
 *  shrink its CPU footprint when Express needs cycles.
 *  Every ffmpeg spawn in this file goes through this helper — there are no
 *  interactive live-serving ffmpeg streams left after the cache-based refactor.
 *  The child's PID is tracked in `_bgFfmpegPids` so live mode flips can re-price
 *  in-flight encodes via `taskpolicy -p` / `renice -p`.
 */
function spawnBackgroundFfmpeg(args: string[], options: Parameters<typeof spawn>[2] = {}) {
  const prefix = bgProcessPrefix();
  const proc = prefix.length > 0
    ? spawn(prefix[0], [...prefix.slice(1), FFMPEG_BIN, ...args], options)
    : spawn(FFMPEG_BIN, args, options);
  if (typeof proc.pid === 'number') {
    const pid = proc.pid;
    _bgFfmpegPids.add(pid);
    proc.on('close', () => { _bgFfmpegPids.delete(pid); });
  }
  return proc;
}

// (Removed: `/videos-live/*`, `/videos-audio/:track/*` and `/videos-track/:track/*`. The
//  cache-based mechanic — /videos-compressed/, /videos-sdr/ — replaces them: segment caches
//  carry the selected audio track (re-encoded to AAC) and handle HDR tone-mapping / SDR
//  re-encoding. Whole-film playback with a non-default audio track is no longer supported;
//  every video-guess question uses time markers. See specs/video-caching.md.)

// ── Compressed segment caching endpoint ──
// Like /videos-sdr/ but for SDR videos: re-encodes segment to H.264 CRF 23 max 1080p.
// URL: /videos-compressed/<startSec>/<endSec>/<path>?track=N
const compressedCacheReady = new Set<string>();
const sdrCacheReady = new Set<string>();

function compressedCacheFile(relPath: string, startSec: number, endSec: number): string {
  const base = cacheSlug(relPath).replace(/\.[^.]+$/, '');
  return path.join(VIDEO_CACHE_BASE, 'compressed', `${base}__${startSec}_${endSec}.mp4`);
}

interface SegmentEncodeParams {
  kind: 'compressed' | 'sdr';
  fullPath: string;
  relPath: string;
  startSec: number;
  endSec: number;
  trackIdx: number | undefined;
  cacheFile: string;
  /** Optional progress callback: percent 0..95 (100 is sent by the caller after rename). */
  onProgress?: (percent: number) => void;
  /** Optional signal to abort the ffmpeg process (used for idle-cancel from SSE clients). */
  signal?: AbortSignal;
  /** Optional bgTask id (created via `bgTaskQueue`) — transitioned to `running`
   *  when the shared encode slot is acquired, or immediately if this call joins
   *  an already-running in-flight encode. */
  taskId?: string;
}

/** In-flight encode tracking for deduplication. When two callers ask for the same cache
 *  file at the same time (e.g. the user clicks "Cache erstellen" while the 2-min auto-warmup
 *  also fires), only one ffmpeg runs — the second caller subscribes to progress and awaits
 *  the same promise. Without this, both processes wrote to the same `.tmp`, one finished +
 *  renamed, the other was left writing to a vanished path → `ffmpeg exit 255`. */
interface InflightEncode {
  promise: Promise<void>;
  progressListeners: Set<(percent: number) => void>;
}
const inflightEncodes = new Map<string, InflightEncode>();

/** Run a background segment encode (compressed SDR, or HDR→SDR tone-mapped) to the given
 *  cache file. Deduplicates concurrent requests for the same cache file — the first caller
 *  owns the encode, subsequent callers attach their progress callback and await the same
 *  promise. The owner's abort signal controls cancellation; callers that join an in-flight
 *  encode cannot abort it (another subscriber wants the result). */
async function runSegmentEncode(p: SegmentEncodeParams): Promise<void> {
  const existing = inflightEncodes.get(p.cacheFile);
  if (existing) {
    // Piggy-backing on an already-running encode: drop this caller's bgTask so the
    // UI shows ONE row for the encode (not one per caller). The caller's SSE stream
    // still receives progress via the `onProgress` listener fanout, so their HTTP
    // response/client continues to work — they just no longer show up as a second
    // redundant entry in SystemTab's active-processes list.
    if (p.taskId) bgTaskCancel(p.taskId);
    if (p.onProgress) existing.progressListeners.add(p.onProgress);
    try {
      await existing.promise;
    } finally {
      if (p.onProgress) existing.progressListeners.delete(p.onProgress);
    }
    return;
  }

  const progressListeners = new Set<(percent: number) => void>();
  if (p.onProgress) progressListeners.add(p.onProgress);
  const fanoutProgress = (pct: number) => {
    for (const cb of progressListeners) {
      try { cb(pct); } catch { /* listener failure is the caller's problem */ }
    }
  };

  // Announce the start of a fresh encode so every open admin client disables its
  // per-question "Cache erstellen" button immediately. Without this, the 500 ms
  // system-status debounce leaves a window where a second click can spawn a
  // duplicate request (server-side dedup handles correctness, but the UX is noisy).
  // `cache-ready` fires the complementary signal when the encode finishes.
  broadcast('cache-started', { kind: p.kind, video: p.relPath, start: p.startSec, end: p.endSec, track: p.trackIdx });
  const promise = runSegmentEncodeInternal({ ...p, onProgress: fanoutProgress });
  inflightEncodes.set(p.cacheFile, { promise, progressListeners });
  try {
    await promise;
  } finally {
    inflightEncodes.delete(p.cacheFile);
  }
}

/** Actual ffmpeg-spawning body. Call via `runSegmentEncode()` so concurrent requests for the
 *  same cache file share a single encode instead of racing on the `.tmp` file. */
async function runSegmentEncodeInternal(p: SegmentEncodeParams): Promise<void> {
  const { kind, fullPath, relPath, startSec, endSec, trackIdx, cacheFile, onProgress, signal } = p;
  const mapArgs = trackIdx !== undefined ? ['-map', '0:v', '-map', `0:a:${trackIdx}`] : [];

  // One probe covers both the tone-mapping branch (needs MaxCLL) and the frame-align
  // logic below (needs fps). `cachedProbe` memoises per relPath so this is cheap.
  let probedFps = 0;
  let probedMaxCLL = hdrCache.get(relPath)?.maxCLL ?? 0;
  try {
    const { videoInfo } = await cachedProbe(fullPath, relPath);
    probedFps = videoInfo?.fps ?? 0;
    if (!probedMaxCLL) probedMaxCLL = videoInfo?.maxCLL ?? 0;
    if (videoInfo) hdrCache.set(relPath, { isHdr: videoInfo.isHdr, maxCLL: probedMaxCLL });
  } catch { /* proceed with defaults */ }

  // Floor markers to the frame PTS so the cache starts on exactly the frame the browser
  // preview showed. Preview renders the frame whose PTS ≤ currentTime; ffmpeg's output
  // seek picks the first frame with PTS ≥ target. Flooring makes both land on the same
  // frame. `+1e-6` absorbs JSON float noise on already-aligned markers.
  const frameFloor = (t: number) => probedFps > 0 ? Math.floor(t * probedFps + 1e-6) / probedFps : t;
  const alignedStart = frameFloor(startSec);
  const alignedEnd = frameFloor(endSec);
  const duration = alignedEnd - alignedStart;

  // Two-pass seek: fast input-seek to ~1 s before target (demuxer lands on a keyframe,
  // nearly free), then accurate output-seek for the remaining second. Input-seek alone
  // (`-ss` before `-i`) is keyframe-only for HEVC / MKV in practice and leaves the cached
  // clip up to one GOP too early. Output-seek alone is frame-accurate but would decode
  // the entire file up to startSec on long sources.
  //
  // Half-frame safety margin on the fine seek — ffmpeg's output seek keeps the first
  // frame whose PTS is ≥ the seek target. Without the margin, float wobble on a target
  // computed as `frame_index / fps` can push it just past the intended frame's PTS,
  // and the cache silently starts one frame late. Subtracting 0.5/fps is half a frame
  // before the intended frame, which no real frame PTS can land inside.
  const PRE_SEEK = 1.0;
  const safety = probedFps > 0 ? 0.5 / probedFps : 0;
  const coarseSeek = Math.max(0, alignedStart - PRE_SEEK);
  const fineSeek = Math.max(0, alignedStart - coarseSeek - safety);

  // HDR path needs the tone-mapping VF with the file's measured MaxCLL for accurate colours.
  const vf = kind === 'sdr'
    ? buildTonemapVf(probedMaxCLL)
    : "scale='min(1920,iw)':-2";

  mkdirSync(path.dirname(cacheFile), { recursive: true });
  const tmpFile = cacheFile + '.tmp';
  // Clear any leftover `.tmp` from a previously-crashed encode so ffmpeg writes a clean file
  // instead of potentially confusing itself with a half-written predecessor. ffmpeg with `-y`
  // already overwrites, but being explicit avoids edge cases on macOS where stale .tmps have
  // caused issues.
  try { unlinkSync(tmpFile); } catch { /* didn't exist */ }
  const tag = `[${kind}]`;
  console.log(`${tag} Transcoding ${relPath} [${startSec}s–${endSec}s]${trackIdx !== undefined ? ` track=${trackIdx}` : ''}`);
  const transcodeStart = Date.now();

  await bgEncodeAcquireForTask(p.taskId);
  try {
    await new Promise<void>((resolve, reject) => {
      const crf = kind === 'sdr' ? '18' : '23';
      const progressArgs = onProgress ? ['-progress', 'pipe:1', '-nostats'] : [];
      const proc = spawnBackgroundFfmpeg([
        ...progressArgs,
        '-ss', String(coarseSeek),
        '-i', fullPath,
        '-ss', String(fineSeek),
        '-t', String(duration),
        ...mapArgs,
        '-vf', vf,
        '-c:v', 'libx264', '-crf', crf, '-preset', 'fast',
        // Force a keyframe every ~1 s. libx264's default GOP is 250, which for a short
        // segment ends up being almost the entire clip — only one keyframe at the start.
        // When the admin cache-preview or the gameshow player seeks to a question/answer
        // marker mid-clip, the browser snaps to the nearest keyframe, which lands many
        // seconds away (typically inside the +1 s end buffer — "wrong scene" on pause).
        // 24 at 23.976 fps ≈ 1 s; `keyint_min=24` makes it strict and `sc_threshold=0`
        // disables extra scene-change keyframes so the spacing stays predictable.
        '-g', '24', '-keyint_min', '24', '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '256k', '-ac', '2',
        '-f', 'mp4', '-movflags', '+faststart',
        '-y', tmpFile,
      ], { stdio: ['ignore', onProgress ? 'pipe' : 'ignore', 'pipe'] });

      const stderrChunks: string[] = [];
      proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString()));

      if (onProgress) {
        proc.stdout?.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            const m = line.match(/^out_time_ms=(\d+)/);
            if (m && duration > 0) {
              const seconds = parseInt(m[1]) / 1_000_000;
              const pct = Math.min(95, Math.round((seconds / duration) * 100));
              onProgress(pct);
            }
          }
        });
      }

      const onAbort = () => { try { proc.kill('SIGTERM'); } catch { /* ignore */ } };
      signal?.addEventListener('abort', onAbort);

      proc.on('close', (code, procSignal) => {
        signal?.removeEventListener('abort', onAbort);
        if (code === 0) resolve();
        else {
          const stderr = stderrChunks.join('');
          console.error(`${tag} ffmpeg exit=${code} signal=${procSignal}\n${stderr}`);
          // Include a short stderr excerpt in the client-facing error so the operator sees
          // the real cause (e.g. "No such filter") instead of just "ffmpeg exit 255".
          const lastMeaningful = stderr.split('\n').reverse().find(l => l.includes(':') && !/^\s*$/.test(l));
          reject(new Error(`ffmpeg exit ${code}${procSignal ? ` (signal ${procSignal})` : ''}${lastMeaningful ? ` — ${lastMeaningful.trim()}` : ''}`));
        }
      });
      proc.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      });
    });
    renameSync(tmpFile, cacheFile);
    if (kind === 'compressed') compressedCacheReady.add(cacheFile);
    else sdrCacheReady.add(cacheFile);
    mirrorCacheToNas(cacheFile);
    // Tell every admin client that this specific cache is now on disk. Fields mirror
    // the tuple `makeRemoteMatchKey` uses (relPath, startSec, endSec, track) so
    // VideoGuessForm can correlate without a server round-trip, and SystemTab can
    // refresh its "missing" counter. Single-question warmup and cache-warm-all both
    // funnel through this function, so one broadcast covers every generation path.
    broadcast('cache-ready', { kind, video: relPath, start: startSec, end: endSec, track: trackIdx });
    const elapsed = ((Date.now() - transcodeStart) / 1000).toFixed(1);
    console.log(`${tag} Done ${relPath} [${startSec}s–${endSec}s] in ${elapsed}s`);
  } catch (err) {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    const elapsed = ((Date.now() - transcodeStart) / 1000).toFixed(1);
    console.error(`${tag} Failed ${relPath} [${startSec}s–${endSec}s] after ${elapsed}s: ${(err as Error).message}`);
    throw err;
  } finally {
    bgEncodeRelease();
  }
}

app.get('/videos-compressed/:start/:end/*splat', async (req, res) => {
  const startSec = parseFloat(req.params.start);
  const endSec = parseFloat(req.params.end);
  if (isNaN(startSec) || isNaN(endSec) || endSec <= startSec) {
    return res.status(400).send('Invalid time range');
  }
  const splat = req.params.splat;
  const filePath = Array.isArray(splat) ? splat.join('/') : splat;
  if (!filePath || !isSafePath(filePath)) return res.status(400).send('Invalid path');

  const trackIdx = req.query.track !== undefined ? parseInt(req.query.track as string) : undefined;
  if (trackIdx !== undefined && (isNaN(trackIdx) || trackIdx < 0)) {
    return res.status(400).send('Invalid track');
  }

  const cacheFile = compressedCacheFile(filePath, startSec, endSec) + (trackIdx !== undefined ? `.t${trackIdx}` : '');
  // strict=1: no live transcoding fallback. Used by the in-game player so ffmpeg never spawns
  // during the show — if the cache is missing we surface a 404 + header so the client can warn.
  const strict = req.query.strict === '1';

  // The cache file is self-contained; resolving the source path is only required when we
  // need to spawn a live encode. Check the source lazily so an offline reference (dangling
  // symlink) still serves pre-built caches. See specs/video-references.md.
  const cacheExists = compressedCacheReady.has(cacheFile) || existsSync(cacheFile);
  if (cacheExists) compressedCacheReady.add(cacheFile);

  if (!cacheExists) {
    compressedCacheReady.delete(cacheFile);
    if (strict) {
      res.setHeader('X-Cache-Status', 'missing');
      return res.status(404).send('Cache missing — generate via warmup-compressed');
    }
    const fullPath = resolveVideoPath(filePath);
    if (!fullPath) return res.status(404).send('Source not reachable and no cache');
    try {
      await runSegmentEncode({
        kind: 'compressed', fullPath, relPath: filePath, startSec, endSec, trackIdx, cacheFile,
      });
    } catch (err) {
      return res.status(500).send(`Compressed transcode failed: ${(err as Error).message}`);
    }
  }

  // Serve with range request support
  const fileStat = statSync(cacheFile);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileStat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'private, max-age=3600',
    });
    const { createReadStream } = await import('fs');
    createReadStream(cacheFile, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileStat.size,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    });
    const { createReadStream } = await import('fs');
    createReadStream(cacheFile).pipe(res);
  }
});

// Serve an HDR→SDR tone-mapped segment of a video.
// URL: /videos-sdr/<startSec>/<endSec>/<path>
// Extracts the segment, applies tone mapping, caches result on disk.
// For non-HDR videos, returns 400 (frontend should use normal route).
// (sdrCacheReady is declared near compressedCacheReady above.)

app.get('/videos-sdr/:start/:end/*splat', async (req, res) => {
  const startSec = parseFloat(req.params.start);
  const endSec = parseFloat(req.params.end);
  if (isNaN(startSec) || isNaN(endSec) || endSec <= startSec) {
    return res.status(400).send('Invalid time range');
  }
  const splat = req.params.splat;
  const filePath = Array.isArray(splat) ? splat.join('/') : splat;
  if (!filePath || !isSafePath(filePath)) return res.status(400).send('Invalid path');

  // Optional audio track selection via ?track=N
  const trackIdx = req.query.track !== undefined ? parseInt(req.query.track as string) : undefined;
  if (trackIdx !== undefined && (isNaN(trackIdx) || trackIdx < 0)) {
    return res.status(400).send('Invalid track');
  }

  const cacheFile = sdrCacheFile(filePath, startSec, endSec) + (trackIdx !== undefined ? `.t${trackIdx}` : '');
  // strict=1: the in-game player uses this so ffmpeg never spawns during live playback.
  const strict = req.query.strict === '1';

  // Self-contained cache — source lookup only needed for live encode. See /videos-compressed/.
  const cacheExists = sdrCacheReady.has(cacheFile) || existsSync(cacheFile);
  if (cacheExists) sdrCacheReady.add(cacheFile);

  if (!cacheExists) {
    sdrCacheReady.delete(cacheFile);
    if (strict) {
      res.setHeader('X-Cache-Status', 'missing');
      return res.status(404).send('Cache missing — generate via warmup-sdr');
    }
    const nasPath = path.join(NAS_BASE, 'videos', filePath);
    const localPath = path.join(LOCAL_ASSETS_BASE, 'videos', filePath);
    const localExists = existsSync(localPath);
    const nasExists = existsSync(nasPath);
    let fullPath: string | null = null;
    if (localExists && nasExists) {
      try {
        const ls = statSync(localPath);
        const ns = statSync(nasPath);
        fullPath = (ls.size === ns.size) ? localPath : nasPath;
      } catch { fullPath = nasPath; }
    } else if (localExists) {
      fullPath = localPath;
    } else if (nasExists) {
      fullPath = nasPath;
    }
    if (!fullPath) return res.status(404).send('Source not reachable and no cache');
    try {
      await runSegmentEncode({
        kind: 'sdr', fullPath, relPath: filePath, startSec, endSec, trackIdx, cacheFile,
      });
    } catch (err) {
      return res.status(500).send(`SDR transcode failed: ${(err as Error).message}`);
    }
  }

  // Serve with range request support
  const fileStat = statSync(cacheFile);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileStat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'private, max-age=3600',
    });
    const { createReadStream } = await import('fs');
    createReadStream(cacheFile, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileStat.size,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    });
    const { createReadStream } = await import('fs');
    createReadStream(cacheFile).pipe(res);
  }
});

// ── Random-frame extraction endpoint (random-frame game type) ──
// Extracts a single random still frame from a video, deterministically chosen by `seed`
// within [start, end] seconds (defaults 180..900, clamped to the real duration), auto-
// skipping near-black / near-uniform frames. The result is cached to disk by (path, seed)
// so React re-renders reuse the same frame and only an explicit re-roll (new seed) changes
// it. See specs/games/random-frame.md.

// When the host sets no explicit bounds we draw the frame from (almost) the WHOLE
// runtime — a fixed early window would make every frame come from the same few
// minutes. Skip the opening and the end credits proportionally instead.
const RANDOM_FRAME_DEFAULT_START_FRAC = 0.05; // skip first 5% (studio logos / intro)
const RANDOM_FRAME_DEFAULT_END_FRAC = 0.92;   // skip last 8% (end credits)
// Absolute fallbacks used only when the real duration can't be probed.
const RANDOM_FRAME_DEFAULT_START = 180; // 3 min
const RANDOM_FRAME_DEFAULT_END = 900;   // 15 min
const RANDOM_FRAME_CANDIDATES = 4;      // candidate timestamps sampled before giving up
const RANDOM_FRAME_MAX_WIDTH = 1280;    // downscale for fast encode + small transfer
const RANDOM_FRAME_DIR = path.join(VIDEO_CACHE_BASE, 'frames');

/** Deterministic mulberry32 PRNG → float in [0,1). Same seed ⇒ same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Extract a single display-sized JPEG frame at time `t` (seconds).
 *  Unlike the cache-warmup encodes, this runs at FULL process priority (no
 *  `bgProcessPrefix` demotion) — it's a live interactive request, not background
 *  work. `-ss` before `-i` does a fast keyframe seek; the frame is downscaled to
 *  RANDOM_FRAME_MAX_WIDTH so both the encode and the HTTP transfer stay quick, and
 *  the decoded buffer doubles as the input to the black-frame check (one ffmpeg
 *  spawn per candidate instead of a probe pass + a full extract). */
function extractDisplayFrame(fullPath: string, t: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error',
      '-ss', t.toFixed(3), '-i', fullPath,
      '-frames:v', '1', '-an', '-sn',
      '-vf', `scale='min(${RANDOM_FRAME_MAX_WIDTH},iw)':-2`,
      '-q:v', '3', '-f', 'image2', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    proc.stdout!.on('data', (c: Buffer) => chunks.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg frame extract exited ${code}`));
    });
  });
}

/** True when a frame is near-black or near-uniform (a fade / solid colour) — the kind of
 *  useless frame the GM would otherwise have to skip manually. */
async function isBadFrame(buf: Buffer): Promise<boolean> {
  try {
    const { channels } = await sharp(buf).stats();
    const avgMean = channels.reduce((a, c) => a + c.mean, 0) / channels.length;
    const maxStdev = Math.max(...channels.map(c => c.stdev));
    return avgMean < 16 || maxStdev < 8;
  } catch {
    return false; // analysis failed → accept the frame rather than loop forever
  }
}

app.get('/api/random-frame', async (req, res) => {
  const filePath = typeof req.query.path === 'string' ? req.query.path : '';
  if (!filePath || !isSafePath(filePath)) return res.status(400).send('Invalid path');

  const seed = Number.parseInt(String(req.query.seed ?? '0'), 10) || 0;
  const reqStart = req.query.start !== undefined ? parseFloat(String(req.query.start)) : NaN;
  const reqEnd = req.query.end !== undefined ? parseFloat(String(req.query.end)) : NaN;

  const cacheFile = path.join(
    RANDOM_FRAME_DIR,
    `${cacheSlug(filePath).replace(/\.[^.]+$/, '')}__${seed}.jpg`,
  );

  // Serve the cached frame if we already extracted this (path, seed).
  if (existsSync(cacheFile)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return createReadStream(cacheFile).pipe(res);
  }

  const fullPath = resolveVideoPath(filePath);
  if (!fullPath) return res.status(404).send('Video not reachable');

  // Clamp the bounds to the real duration so short videos still work.
  let duration = 0;
  try {
    const probe = await cachedProbe(fullPath, filePath);
    duration = probe.videoInfo?.duration ?? 0;
  } catch { /* fall back to requested bounds */ }

  // Default bounds span (almost) the whole runtime so the frame is genuinely random
  // across the film; explicit per-question bounds always win. Fixed seconds are only a
  // fallback for when the duration probe failed.
  let end = Number.isFinite(reqEnd)
    ? reqEnd
    : duration > 0 ? duration * RANDOM_FRAME_DEFAULT_END_FRAC : RANDOM_FRAME_DEFAULT_END;
  if (duration > 0) end = Math.min(end, duration);
  if (!(end > 0)) end = duration > 0 ? duration : RANDOM_FRAME_DEFAULT_END;
  let start = Number.isFinite(reqStart)
    ? reqStart
    : duration > 0 ? duration * RANDOM_FRAME_DEFAULT_START_FRAC : RANDOM_FRAME_DEFAULT_START;
  start = Math.max(0, Math.min(start, Math.max(0, end - 1)));

  // Sample candidate timestamps deterministically; extract each one (display-sized) and
  // serve the first non-black frame, keeping the first extracted frame as a fallback so we
  // always return something. One ffmpeg spawn per candidate.
  const rand = mulberry32(seed);
  let frame: Buffer | null = null;
  let fallback: Buffer | null = null;
  for (let i = 0; i < RANDOM_FRAME_CANDIDATES; i++) {
    const t = start + rand() * (end - start);
    let buf: Buffer;
    try {
      buf = await extractDisplayFrame(fullPath, t);
    } catch {
      continue; // try the next candidate
    }
    if (!fallback) fallback = buf;
    if (!(await isBadFrame(buf))) { frame = buf; break; }
  }

  frame = frame ?? fallback;
  if (!frame) return res.status(500).send('Frame extraction failed');

  try {
    await mkdir(RANDOM_FRAME_DIR, { recursive: true });
    await writeFile(cacheFile, frame);
  } catch { /* non-fatal — still serve from memory */ }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(frame);
});

// ── Config helpers ──

/**
 * Clean-install flag — true when loadConfig() last resolved to the built-in
 * template fallback instead of a real config.json. Exposed via /api/settings.
 * See specs/clean-install.md and server/clean-install.ts.
 */
let cleanInstallActive = false;

async function loadConfig(): Promise<AppConfig> {
  const { config, isCleanInstall } = await loadConfigWithFallback(CONFIG_PATH);
  cleanInstallActive = isCleanInstall;
  return config;
}

/**
 * Serialize config.json read-modify-write cycles. Each writer already writes
 * atomically (tmp + rename), but two concurrent mutating requests (e.g. a game
 * delete cascading gameOrder cleanup racing an admin config save) would
 * otherwise interleave their read/write phases and the last writer would win.
 */
let configWriteChain: Promise<unknown> = Promise.resolve();
function withConfigWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = configWriteChain.then(fn, fn);
  configWriteChain = next.catch(() => { /* error surfaces to the caller of `next` */ });
  return next;
}

/**
 * Get the active gameOrder from config.
 * Resolves config.activeGameshow → config.gameshows[active].gameOrder
 */
function getActiveGameOrder(config: AppConfig): string[] {
  const active = config.gameshows[config.activeGameshow];
  if (!active) {
    throw new Error(`Active gameshow "${config.activeGameshow}" not found. Available: ${Object.keys(config.gameshows).join(', ')}`);
  }
  return active.gameOrder;
}

/**
 * Drop every gameOrder ref matching `shouldDrop` from config.json so a deleted
 * game / instance never leaves a dangling reference that breaks the show.
 *
 * Best-effort and config-safe: a missing, git-crypt-encrypted, or unparseable
 * config is left untouched (we never overwrite an encrypted config with
 * plaintext). Writes atomically (tmp + rename), preserving the file's indent.
 * Returns the removed refs (tagged with gameshow) for reporting.
 *
 * See specs/config-gameorder-cascade.md.
 */
async function cascadeGameOrderCleanup(
  shouldDrop: (ref: string) => boolean,
): Promise<RemovedGameRef[]> {
  return withConfigWriteLock(() => cascadeGameOrderCleanupUnlocked(shouldDrop));
}

async function cascadeGameOrderCleanupUnlocked(
  shouldDrop: (ref: string) => boolean,
): Promise<RemovedGameRef[]> {
  let raw: Buffer;
  try {
    raw = await readFile(CONFIG_PATH);
  } catch {
    return []; // no config yet (clean install) — nothing to clean
  }
  if (isGitCryptBlob(raw)) return []; // encrypted — never rewrite as plaintext
  let config: AppConfig;
  try {
    config = JSON.parse(raw.toString('utf8')) as AppConfig;
  } catch {
    return []; // unparseable — leave it alone
  }
  const removed = pruneGameOrder(config, shouldDrop);
  if (removed.length === 0) return [];
  const indent = await detectJsonIndent(CONFIG_PATH);
  const tmpPath = `${CONFIG_PATH}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, JSON.stringify(config, null, indent) + '\n', 'utf8');
    await rename(tmpPath, CONFIG_PATH);
  } catch (err) {
    await unlink(tmpPath).catch(() => { /* tmp may already be gone */ });
    throw err;
  }
  return removed;
}

/**
 * Load a game config from games/<gameName>.json, optionally selecting an instance.
 *
 * Single-instance file: the file IS the GameConfig.
 * Multi-instance file: base config + instances.{name} merged together.
 */
const warnedDanglingPresets = new Set<string>();

async function loadGameConfig(
  gameName: string,
  instanceName: string | null,
  presets?: RulesPreset[],
): Promise<GameConfig> {
  const filePath = path.join(GAMES_DIR, `${gameName}.json`);
  const data = await readFile(filePath, 'utf8');
  const fileContent = JSON.parse(data);

  let resolved: GameConfig;
  if ('instances' in fileContent && fileContent.instances) {
    // Multi-instance game file
    const { instances, ...base } = fileContent as MultiInstanceGameFile & Record<string, unknown>;
    const allKeys = Object.keys(instances);
    const nonArchiveKeys = allKeys.filter(k => k.toLowerCase() !== 'archive');
    const archiveKey = allKeys.find(k => k.toLowerCase() === 'archive');
    // Archive is normally hidden from gameOrder, but when no non-archive
    // instance has any questions, the editor exposes archive as a fallback —
    // so we accept it here under the same condition.
    const hasNonEmptyNonArchive = nonArchiveKeys.some(k => {
      const inst = instances[k] as { questions?: unknown[] } | undefined;
      return Array.isArray(inst?.questions) && inst.questions.length > 0;
    });
    const selectableKeys = (archiveKey && !hasNonEmptyNonArchive)
      ? [...nonArchiveKeys, archiveKey]
      : nonArchiveKeys;
    if (!instanceName) {
      throw new Error(`Game "${gameName}" has multiple instances but no instance was specified. Available: ${selectableKeys.join(', ')}`);
    }
    if (instanceName.toLowerCase() === 'archive' && hasNonEmptyNonArchive) {
      throw new Error(`Instance "${instanceName}" in "${gameName}" is reserved for archived questions and cannot be used in gameOrder`);
    }
    const instance = instances[instanceName];
    if (!instance) {
      throw new Error(`Instance "${instanceName}" not found in game "${gameName}". Available: ${selectableKeys.join(', ')}`);
    }
    resolved = { ...base, ...instance } as GameConfig;
  } else {
    // Single-instance game file
    if (instanceName) {
      throw new Error(`Game "${gameName}" is single-instance but instance "${instanceName}" was specified`);
    }
    resolved = fileContent as GameConfig;
  }

  if (resolved.rulesPreset && presets) {
    const merged = resolveRulesPreset(resolved, presets);
    if (merged) {
      resolved = { ...resolved, rules: merged };
    } else {
      const key = `${gameName}:${instanceName ?? ''}:${resolved.rulesPreset}`;
      if (!warnedDanglingPresets.has(key)) {
        warnedDanglingPresets.add(key);
        console.warn(`[rulesPreset] Game "${gameName}"${instanceName ? `/${instanceName}` : ''} references unknown preset "${resolved.rulesPreset}". Falling back to game rules.`);
      }
    }
    delete (resolved as { rulesPreset?: string }).rulesPreset;
  }

  if (resolved.type === 'video-guess') {
    const videosDir = path.join(LOCAL_ASSETS_BASE, 'videos');
    await resolveVideoGuessLanguage(resolved, relPath =>
      cachedProbe(path.join(videosDir, relPath), relPath));
  }

  return resolved;
}

// ── API Routes ──

const AUDIO_FILE_RE = /\.(mp3|m4a|wav|ogg|opus)$/i;

async function listAudioFiles(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter(f => AUDIO_FILE_RE.test(f) && !f.startsWith('.'));
  } catch {
    return [];
  }
}

app.get('/api/background-music', async (req, res) => {
  const musicDir = path.join(LOCAL_ASSETS_BASE, 'background-music');
  const theme = typeof req.query.theme === 'string' ? req.query.theme : '';

  if (theme && VALID_THEMES.includes(theme)) {
    const themeFiles = await listAudioFiles(path.join(musicDir, theme));
    if (themeFiles.length > 0) {
      return res.json(themeFiles.map(f => `${theme}/${f}`));
    }
  }

  res.json(await listAudioFiles(musicDir));
});

app.get('/api/settings', async (_req, res) => {
  try {
    const config = await loadConfig();
    const activeShow = config.gameshows?.[config.activeGameshow];
    res.json({
      pointSystemEnabled: config.pointSystemEnabled !== false,
      teamRandomizationEnabled: config.teamRandomizationEnabled !== false,
      globalRules: config.globalRules || [
        'Es gibt mehrere Spiele.',
        'Bei jedem Spiel wird am Ende entschieden welches Team das Spiel gewonnen hat.',
        'Das erste Spiel ist 1 Punkt wert, das zweite 2 Punkte, etc.',
        'Das Team mit den meisten Punkten gewinnt am Ende.',
      ],
      isCleanInstall: cleanInstallActive,
      enabledJokers: activeShow?.enabledJokers ?? [],
      jokersInLastGame: config.jokersInLastGame === true,
    });
  } catch {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// ── Theme settings (server-side, gitignored) ──

const VALID_THEMES = ['galaxia', 'harry-potter', 'dnd', 'deepsea', 'enterprise', 'retro', 'minecraft', 'classical-music', 'modern-music', 'movie-quiz'];
const DEFAULT_THEME = 'galaxia';

interface ThemeSettings {
  frontend: string;
  admin: string;
}

async function loadThemeSettings(): Promise<ThemeSettings> {
  try {
    const data = await readFile(THEME_SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(data);
    return {
      frontend: VALID_THEMES.includes(parsed.frontend) ? parsed.frontend : DEFAULT_THEME,
      admin: VALID_THEMES.includes(parsed.admin) ? parsed.admin : DEFAULT_THEME,
    };
  } catch { /* missing or unreadable — fall back to defaults */ }
  return { frontend: DEFAULT_THEME, admin: DEFAULT_THEME };
}

async function saveThemeSettings(settings: ThemeSettings): Promise<void> {
  const tmpPath = `${THEME_SETTINGS_PATH}.tmp`;
  await writeFile(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  await rename(tmpPath, THEME_SETTINGS_PATH);
}

app.get('/api/theme', async (_req, res) => {
  res.json(await loadThemeSettings());
});

app.put('/api/theme', async (req, res) => {
  const current = await loadThemeSettings();
  const { frontend, admin } = req.body ?? {};
  if (frontend !== undefined) {
    if (!VALID_THEMES.includes(frontend)) return res.status(400).json({ error: `Invalid theme: ${frontend}` });
    current.frontend = frontend;
  }
  if (admin !== undefined) {
    if (!VALID_THEMES.includes(admin)) return res.status(400).json({ error: `Invalid theme: ${admin}` });
    current.admin = admin;
  }
  await saveThemeSettings(current);
  res.json(current);
});

// GET /api/video-hdr?path=... — check if a video is HDR (lightweight, for frontend use)
const hdrCache = loadHdrCache();
app.get('/api/video-hdr', async (req, res) => {
  const videoPath = (req.query.path as string || '').replace(/^\/videos\//, '');
  if (!videoPath || !isSafePath(videoPath)) return res.json({ isHdr: false, maxCLL: 0 });

  const cached = hdrCache.get(videoPath);
  if (cached !== undefined && (cached.maxCLL > 0 || !cached.isHdr)) {
    return res.json({ isHdr: cached.isHdr, maxCLL: cached.maxCLL });
  }

  const nasPath = path.join(NAS_BASE, 'videos', videoPath);
  const localPath = path.join(LOCAL_ASSETS_BASE, 'videos', videoPath);
  const fullPath = existsSync(localPath) ? localPath : existsSync(nasPath) ? nasPath : null;
  if (!fullPath) {
    // Source unreachable — return whatever we previously probed, even if maxCLL wasn't
    // populated yet. Without this the client flips to `isHdr=false` when the NAS disconnects,
    // and the VideoGuessForm ends up looking up the compressed cache URL for what was
    // originally an SDR-cached HDR video.
    if (cached !== undefined) return res.json({ isHdr: cached.isHdr, maxCLL: cached.maxCLL });
    return res.json({ isHdr: false, maxCLL: 0 });
  }

  try {
    const { videoInfo } = await cachedProbe(fullPath, videoPath);
    const isHdr = videoInfo?.isHdr ?? false;
    const maxCLL = videoInfo?.maxCLL ?? 0;
    hdrCache.set(videoPath, { isHdr, maxCLL });
    saveHdrCache();
    res.json({ isHdr, maxCLL });
  } catch {
    res.json({ isHdr: false, maxCLL: 0 });
  }
});

app.get('/api/game/:index', async (req, res) => {
  try {
    const config = await loadConfig();
    const gameOrder = getActiveGameOrder(config);
    const index = parseInt(req.params.index);

    if (isNaN(index) || index < 0 || index >= gameOrder.length) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const gameRef = gameOrder[index];
    const { gameName, instanceName } = parseGameRef(gameRef);

    let gameConfig: GameConfig;
    try {
      gameConfig = await loadGameConfig(gameName, instanceName, config.rulesPresets);
    } catch (err) {
      return res.status(404).json({ error: `Game configuration not found: ${(err as Error).message}` });
    }

    if (gameConfig.type === 'colorguess') {
      const imagesDir = categoryDir('images');
      const enrichedQuestions = await Promise.all(
        gameConfig.questions.map(async q => {
          const relPath = q.image.replace(/^\/+images\/+/, '');
          const colors = await getColorProfile(imagesDir, relPath);
          return { ...q, colors };
        })
      );
      gameConfig = { ...gameConfig, questions: enrichedQuestions };
    }

    const baseResponse = {
      gameId: gameRef,
      currentIndex: index,
      totalGames: gameOrder.length,
      pointSystemEnabled: config.pointSystemEnabled !== false,
    };

    res.json({ ...baseResponse, config: gameConfig });
  } catch {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// ── Admin Backend API ──

// GET /api/backend/games — list all game files
// Silently skips git-crypt encrypted blobs — a fresh clone of an encrypted
// repo should look empty (the admin then offers "Beispiele erstellen"), not
// like a wall of "JSON-Fehler" badges. See specs/example-games.md.
app.get('/api/backend/games', async (_req, res) => {
  try {
    const files = await readdir(GAMES_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.includes('.fingerprints.'));

    const results = await Promise.all(
      jsonFiles.map(async (file): Promise<GameFileSummary | null> => {
        const fileName = file.replace('.json', '');
        try {
          const raw = await readFile(path.join(GAMES_DIR, file));
          if (isGitCryptBlob(raw)) return null;
          const content = JSON.parse(raw.toString('utf8'));
          const isSingleInstance = !('instances' in content && content.instances);
          const instancePlayers: Record<string, string[]> = {};
          if (!isSingleInstance && content.instances) {
            for (const [key, inst] of Object.entries(content.instances as Record<string, { _players?: string[] }>)) {
              if (inst._players) instancePlayers[key] = inst._players;
            }
          }
          // Archive normally hides from the gameshow editor's instance picker.
          // Exception: when no non-archive instance has any questions yet, expose
          // the archive so the user has something selectable. An empty `v1`
          // (questions: []) counts the same as v1 not existing.
          let instances: string[] = [];
          if (!isSingleInstance) {
            const allKeys = Object.keys(content.instances);
            const archiveKey = allKeys.find(k => k.toLowerCase() === 'archive');
            const nonArchiveKeys = allKeys.filter(k => k.toLowerCase() !== 'archive');
            const hasNonEmptyNonArchive = nonArchiveKeys.some(k => {
              const inst = content.instances[k] as { questions?: unknown[] } | undefined;
              return Array.isArray(inst?.questions) && inst.questions.length > 0;
            });
            instances = archiveKey && !hasNonEmptyNonArchive
              ? [...nonArchiveKeys, archiveKey]
              : nonArchiveKeys;
          }
          return {
            fileName,
            type: content.type,
            title: content.title,
            instances,
            isSingleInstance,
            instancePlayers: Object.keys(instancePlayers).length > 0 ? instancePlayers : undefined,
          };
        } catch (err) {
          console.warn(`Skipping invalid game file "${file}": ${(err as Error).message}`);
          return {
            fileName,
            type: 'simple-quiz',
            title: fileName,
            instances: [],
            isSingleInstance: true,
            parseError: (err as Error).message,
          };
        }
      })
    );
    const summaries = results.filter((s): s is GameFileSummary => s !== null);

    summaries.sort((a, b) => a.fileName.localeCompare(b.fileName));
    res.json({ games: summaries });
  } catch (err) {
    res.status(500).json({ error: `Failed to list games: ${(err as Error).message}` });
  }
});

// GET /api/backend/games/:fileName — return raw game file JSON
app.get('/api/backend/games/:fileName', async (req, res) => {
  const { fileName } = req.params;
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  try {
    const data = await readFile(path.join(GAMES_DIR, `${fileName}.json`), 'utf8');
    res.json(JSON.parse(data));
  } catch {
    res.status(404).json({ error: 'Game not found' });
  }
});

// PUT /api/backend/games/:fileName — write game file (atomic)
app.put('/api/backend/games/:fileName', async (req, res) => {
  const { fileName } = req.params;
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  const filePath = path.join(GAMES_DIR, `${fileName}.json`);
  // Unique tmp filename per save — two concurrent saves for the same game (e.g. two rapid
  // drag-reorder-triggered debounces that fire before the first save's rename has completed)
  // must not share a tmp path, or one rename consumes the tmp file and the other fails with
  // ENOENT on rename.
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    // Enforce video-guess lock: if any instance was locked in the on-disk version and the
    // incoming body keeps it locked, its questions must be unchanged. Unlocking (flipping
    // `locked: false`) is always allowed. See specs/video-guess-lock.md.
    const lockViolation = await checkLockedInstanceViolation(filePath, req.body);
    if (lockViolation) {
      return res.status(409).json({ error: lockViolation.error, instance: lockViolation.instance });
    }
    const indent = await detectJsonIndent(filePath);
    await writeFile(tmpPath, JSON.stringify(req.body, null, indent) + '\n', 'utf8');
    await rename(tmpPath, filePath);
    res.json({ success: true });
    // Save may have changed marker values → old segment-cache files are now orphaned.
    // Run prune in the background so the save response is fast. Errors are logged inside.
    pruneUnusedCaches().catch(err => console.warn(`[cache] Prune after save failed: ${(err as Error).message}`));
  } catch (err) {
    // Best-effort cleanup of the unique tmp if writeFile succeeded but rename failed.
    await unlink(tmpPath).catch(() => { /* tmp may already be gone */ });
    res.status(500).json({ error: `Failed to save game: ${(err as Error).message}` });
  }
});

/** Cache-identity fingerprint for a single question — only the fields that
 *  determine the cache filename. Changing `answer`, `answerImage`, `disabled`,
 *  or the instance-level `language` does not invalidate caches, so those stay
 *  editable while locked. */
function questionCacheIdentity(q: unknown): string {
  if (!q || typeof q !== 'object') return '';
  const r = q as Record<string, unknown>;
  return JSON.stringify([
    typeof r.video === 'string' ? r.video : '',
    typeof r.videoStart === 'number' ? r.videoStart : null,
    typeof r.videoQuestionEnd === 'number' ? r.videoQuestionEnd : null,
    typeof r.videoAnswerEnd === 'number' ? r.videoAnswerEnd : null,
    typeof r.audioTrack === 'number' ? r.audioTrack : null,
  ]);
}

function cacheIdentitiesDiffer(oldQs: unknown, newQs: unknown): boolean {
  const a = Array.isArray(oldQs) ? oldQs : [];
  const b = Array.isArray(newQs) ? newQs : [];
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (questionCacheIdentity(a[i]) !== questionCacheIdentity(b[i])) return true;
  }
  return false;
}

/** For a game file being saved, compare each instance's old `locked` state with
 *  the incoming body. If an instance was locked on disk AND remains locked in
 *  the new body AND a cache-identity field changed (video path, markers, or
 *  audio track), return a violation. Fields that don't affect the cache
 *  (language default, answer text, answerImage, rules, etc.) are allowed to
 *  change freely while locked. Unlocking is always allowed. */
async function checkLockedInstanceViolation(
  filePath: string,
  newBody: unknown,
): Promise<{ error: string; instance: string } | null> {
  if (!newBody || typeof newBody !== 'object') return null;
  let oldRaw: string;
  try { oldRaw = await readFile(filePath, 'utf8'); }
  catch { return null; /* new file — no lock state yet */ }
  let oldData: Record<string, unknown>;
  try { oldData = JSON.parse(oldRaw); }
  catch { return null; }
  const newData = newBody as Record<string, unknown>;
  if (oldData.type !== 'video-guess' || newData.type !== 'video-guess') return null;

  // Top-level locked (single-instance files).
  if (oldData.locked === true && newData.locked === true) {
    if (cacheIdentitiesDiffer(oldData.questions, newData.questions)) {
      return { error: 'Instanz ist gesperrt — Marker und Videozuordnungen können nicht geändert werden', instance: '(root)' };
    }
  }

  // Multi-instance files.
  const oldInstances = (oldData.instances as Record<string, Record<string, unknown>> | undefined) ?? {};
  const newInstances = (newData.instances as Record<string, Record<string, unknown>> | undefined) ?? {};
  for (const [key, oldInst] of Object.entries(oldInstances)) {
    if (oldInst?.locked !== true) continue;
    const newInst = newInstances[key];
    if (!newInst) continue; // instance removed — treat like unlock (allowed)
    if (newInst.locked !== true) continue; // unlocking — allowed
    if (cacheIdentitiesDiffer(oldInst.questions, newInst.questions)) {
      return { error: `Instanz "${key}" ist gesperrt — Marker und Videozuordnungen können nicht geändert werden`, instance: key };
    }
  }
  return null;
}

// POST /api/backend/games/:fileName/instances/:instance/unlock-precheck — check source file reachability
app.post('/api/backend/games/:fileName/instances/:instance/unlock-precheck', async (req, res) => {
  const { fileName, instance } = req.params;
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  if (!isSafePath(instance)) return res.status(400).json({ error: 'Invalid instance' });
  try {
    const raw = await readFile(path.join(GAMES_DIR, `${fileName}.json`), 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.type !== 'video-guess') {
      return res.status(400).json({ error: 'Nur video-guess-Spiele unterstützen Lock-Precheck' });
    }
    let questions: Array<Record<string, unknown>> | undefined;
    if (instance === '(root)') {
      questions = Array.isArray(data.questions) ? (data.questions as Array<Record<string, unknown>>) : undefined;
    } else {
      const instances = data.instances as Record<string, Record<string, unknown>> | undefined;
      const inst = instances?.[instance];
      questions = Array.isArray(inst?.questions) ? (inst.questions as Array<Record<string, unknown>>) : undefined;
    }
    if (!questions) {
      return res.status(404).json({ error: 'Instanz nicht gefunden' });
    }
    const references = await getReferenceMapCached();
    const seenPaths = new Set<string>();
    const missing: string[] = [];
    const offlineReferences: string[] = [];
    for (const q of questions) {
      const video = typeof q.video === 'string' ? q.video : undefined;
      if (!video) continue;
      if (seenPaths.has(video)) continue;
      seenPaths.add(video);
      const relPath = video.replace(/^\/videos\//, '');
      const resolved = resolveVideoPath(relPath);
      if (resolved) continue; // file reachable (copy or online reference)
      if (references[relPath]) {
        offlineReferences.push(video);
      } else {
        missing.push(video);
      }
    }
    res.json({ missing, offlineReferences });
  } catch (err) {
    res.status(500).json({ error: `Precheck fehlgeschlagen: ${(err as Error).message}` });
  }
});

// POST /api/backend/games — create new game file
app.post('/api/backend/games', async (req, res) => {
  const { fileName, gameFile } = req.body as { fileName: string; gameFile: unknown };
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  const filePath = path.join(GAMES_DIR, `${fileName}.json`);
  if (existsSync(filePath)) return res.status(409).json({ error: 'Game already exists' });
  try {
    await writeFile(filePath, JSON.stringify(gameFile, null, 2) + '\n', 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to create game: ${(err as Error).message}` });
  }
});

// POST /api/backend/games/examples — generate the example games ("Beispiele") +
// their self-synthesized media, then add/activate the "beispiele" gameshow.
// Idempotent. Backs the admin "Beispiele erstellen" button + `npm run fixtures`.
// See specs/example-games.md.
app.post('/api/backend/games/examples', async (_req, res) => {
  try {
    const result = await withConfigWriteLock(() => materializeExamples({
      gamesDir: GAMES_DIR,
      localAssetsBase: LOCAL_ASSETS_BASE,
      configPath: CONFIG_PATH,
    }));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: `Beispiele erstellen fehlgeschlagen: ${(err as Error).message}` });
  }
});

// POST /api/backend/games/:fileName/rename — rename game file + update config refs
app.post('/api/backend/games/:fileName/rename', async (req, res) => {
  const { fileName } = req.params;
  const { newFileName } = req.body as { newFileName: string };
  if (!isSafeFileName(fileName) || !newFileName || !isSafeFileName(newFileName)) {
    return res.status(400).json({ error: 'Invalid file name' });
  }
  if (fileName === newFileName) return res.json({ success: true, newFileName });

  const oldPath = path.join(GAMES_DIR, `${fileName}.json`);
  const newPath = path.join(GAMES_DIR, `${newFileName}.json`);

  if (!existsSync(oldPath)) return res.status(404).json({ error: 'Game not found' });
  if (existsSync(newPath)) return res.status(409).json({ error: `Spiel "${newFileName}" existiert bereits` });

  try {
    await rename(oldPath, newPath);

    // Update all gameOrder references in config.json
    await withConfigWriteLock(async () => {
      const configData = await readFile(CONFIG_PATH, 'utf8');
      const config = JSON.parse(configData);
      let changed = false;
      if (config.gameshows) {
        for (const gs of Object.values(config.gameshows) as Array<{ gameOrder?: string[] }>) {
          if (!gs.gameOrder) continue;
          gs.gameOrder = gs.gameOrder.map((ref: string) => {
            const { gameName, instanceName } = parseGameRef(ref);
            if (gameName === fileName) {
              changed = true;
              return instanceName ? `${newFileName}/${instanceName}` : newFileName;
            }
            return ref;
          });
        }
      }
      if (changed) {
        const indent = await detectJsonIndent(CONFIG_PATH);
        const tmpPath = `${CONFIG_PATH}.tmp`;
        await writeFile(tmpPath, JSON.stringify(config, null, indent) + '\n', 'utf8');
        await rename(tmpPath, CONFIG_PATH);
      }
    });

    res.json({ success: true, newFileName });
  } catch (err) {
    res.status(500).json({ error: `Failed to rename game: ${(err as Error).message}` });
  }
});

// DELETE /api/backend/games/:fileName — delete game file + cascade-clean config refs
app.delete('/api/backend/games/:fileName', async (req, res) => {
  const { fileName } = req.params;
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  try {
    await unlink(path.join(GAMES_DIR, `${fileName}.json`));
  } catch {
    return res.status(404).json({ error: 'Game not found' });
  }
  // Cascade: drop every gameOrder ref (bare or instance-qualified) to this game from all
  // gameshows so the deleted game never leaves a dangling reference. Best-effort — the file
  // is already gone, so a config-write failure must not fail the response. See
  // specs/config-gameorder-cascade.md.
  let removedRefs: RemovedGameRef[] = [];
  try {
    removedRefs = await cascadeGameOrderCleanup(isRefToGame(fileName));
  } catch (err) {
    console.warn(`[config] gameOrder cleanup after deleting "${fileName}" failed: ${(err as Error).message}`);
  }
  res.json({ success: true, removedRefs });
});

// DELETE /api/backend/games/:fileName/instances/:instance — delete one instance + cascade-clean config refs
app.delete('/api/backend/games/:fileName/instances/:instance', async (req, res) => {
  const { fileName, instance } = req.params;
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  if (!isSafePath(instance)) return res.status(400).json({ error: 'Invalid instance' });
  const filePath = path.join(GAMES_DIR, `${fileName}.json`);
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return res.status(404).json({ error: 'Game not found' });
  }
  const instances = data.instances as Record<string, unknown> | undefined;
  if (!instances || typeof instances !== 'object' || !(instance in instances)) {
    return res.status(404).json({ error: 'Instance not found' });
  }
  delete instances[instance];
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    const indent = await detectJsonIndent(filePath);
    await writeFile(tmpPath, JSON.stringify(data, null, indent) + '\n', 'utf8');
    await rename(tmpPath, filePath);
  } catch (err) {
    await unlink(tmpPath).catch(() => { /* tmp may already be gone */ });
    return res.status(500).json({ error: `Failed to delete instance: ${(err as Error).message}` });
  }
  // Cascade: drop the gameOrder ref to this exact instance from all gameshows. Best-effort —
  // the instance is already removed from the file. See specs/config-gameorder-cascade.md.
  let removedRefs: RemovedGameRef[] = [];
  try {
    removedRefs = await cascadeGameOrderCleanup(isRefToInstance(fileName, instance));
  } catch (err) {
    console.warn(`[config] gameOrder cleanup after deleting instance "${fileName}/${instance}" failed: ${(err as Error).message}`);
  }
  res.json({ success: true, removedRefs });
});

// GET /api/backend/bandle/catalog — return the Bandle song catalog
// Scans local-assets/audio/bandle/*/metadata.json for per-song metadata
app.get('/api/backend/bandle/catalog', async (_req, res) => {
  const bandleDir = path.join(LOCAL_ASSETS_BASE, 'audio', 'bandle');
  let entries;
  try {
    entries = await readdir(bandleDir, { withFileTypes: true });
  } catch {
    return res.json([]); // no bandle dir yet
  }
  const catalog = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(bandleDir, entry.name, 'metadata.json');
    try {
      catalog.push(JSON.parse(await readFile(metaPath, 'utf8')));
    } catch { /* missing or malformed — skip */ }
  }
  res.json(catalog);
});

// POST /api/backend/bandle/download-audio — download audio for a song from bandle CDN
// Body: { path: string } — the bandle song path/ID
// This is called when a song is added to a game instance and audio isn't yet local
app.post('/api/backend/bandle/download-audio', async (req, res) => {
  const { bandlePath } = req.body as { bandlePath: string };
  if (!bandlePath || !/^[a-f0-9]+$/.test(bandlePath)) {
    return res.status(400).json({ error: 'Invalid bandle path' });
  }
  const dir = path.join(LOCAL_ASSETS_BASE, 'audio', 'bandle', bandlePath);
  // Check if already downloaded
  if (existsSync(path.join(dir, 'track1.mp3'))) {
    return res.json({ success: true, alreadyExists: true });
  }
  // Audio must be downloaded via the browser (signed URLs require Firebase auth).
  // Return the expected directory so the frontend knows where files should go.
  return res.json({ success: false, needsDownload: true, dir: `/audio/bandle/${bandlePath}` });
});

// GET /api/backend/bandle/available-audio — list all bandle song folders that have audio
app.get('/api/backend/bandle/available-audio', (_req, res) => {
  const dir = path.join(LOCAL_ASSETS_BASE, 'audio', 'bandle');
  if (!existsSync(dir)) return res.json({ folders: [] });
  const entries = readdirSync(dir, { withFileTypes: true });
  const folders = entries
    .filter(e => e.isDirectory() && existsSync(path.join(dir, e.name, 'track1.mp3')))
    .map(e => e.name);
  res.json({ folders });
});

// GET /api/backend/bandle/audio-status/:path — check if audio files exist locally
app.get('/api/backend/bandle/audio-status/:bandlePath', (req, res) => {
  const { bandlePath } = req.params;
  if (!bandlePath || !/^[a-f0-9]+$/.test(bandlePath)) {
    return res.status(400).json({ error: 'Invalid bandle path' });
  }
  const dir = path.join(LOCAL_ASSETS_BASE, 'audio', 'bandle', bandlePath);
  const tracks: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const f = path.join(dir, `track${i}.mp3`);
    if (existsSync(f)) tracks.push(`/audio/bandle/${bandlePath}/track${i}.mp3`);
  }
  res.json({ available: tracks.length > 0, tracks });
});

// GET /api/backend/config — return full config.json
app.get('/api/backend/config', async (_req, res) => {
  try {
    const data = await readFile(CONFIG_PATH, 'utf8');
    res.json(JSON.parse(data));
  } catch {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// PUT /api/backend/config — write config.json (atomic)
app.put('/api/backend/config', async (req, res) => {
  const tmpPath = `${CONFIG_PATH}.tmp`;
  try {
    await withConfigWriteLock(async () => {
      const indent = await detectJsonIndent(CONFIG_PATH);
      await writeFile(tmpPath, JSON.stringify(req.body, null, indent) + '\n', 'utf8');
      await rename(tmpPath, CONFIG_PATH);
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to save config: ${(err as Error).message}` });
  }
});

// Compare an asset reference to a relative search path, tolerating an optional
// leading slash. Game JSONs are inconsistent here — some entries use
// "/audio/foo.m4a", others "audio/foo.m4a" — and DAM usage detection should
// match both forms. Case-insensitive so on-disk casing changes don't desync
// detection from references the user hasn't normalized yet (and so case-only
// mismatches on case-insensitive filesystems don't silently hide usages).
function pathRefMatches(value: unknown, relPath: string): boolean {
  if (typeof value !== 'string') return false;
  const stripped = value.startsWith('/') ? value.slice(1) : value;
  return stripped.toLowerCase() === relPath.toLowerCase();
}

// Case-insensitive substring check for asset references inside a raw game JSON
// string. macOS APFS is case-insensitive, so the file/reference casing can
// drift over time — the DAM must match regardless.
function includesRefCI(haystack: string, relPath: string): boolean {
  return haystack.toLowerCase().includes(relPath.toLowerCase());
}

// Case-insensitive find, case-preserving replace for rewriting asset refs in
// game JSONs after a rename/move/merge. Escapes regex metacharacters in `from`
// so paths with `.`, `(`, etc. match literally.
function replaceRefCI(haystack: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return haystack.replace(new RegExp(escaped, 'gi'), to);
}

// Helper: scan a questions array for audio trim markers for a given audio path
function scanQuestionsForMarkers(questions: unknown, audioRelPath: string): { start?: number; end?: number }[] {
  const results: { start?: number; end?: number }[] = [];
  if (!Array.isArray(questions)) return results;
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue;
    const qo = q as Record<string, unknown>;
    if (pathRefMatches(qo.questionAudio, audioRelPath)) {
      results.push({
        start: typeof qo.questionAudioStart === 'number' ? qo.questionAudioStart : undefined,
        end: typeof qo.questionAudioEnd === 'number' ? qo.questionAudioEnd : undefined,
      });
    }
    if (pathRefMatches(qo.answerAudio, audioRelPath)) {
      results.push({
        start: typeof qo.answerAudioStart === 'number' ? qo.answerAudioStart : undefined,
        end: typeof qo.answerAudioEnd === 'number' ? qo.answerAudioEnd : undefined,
      });
    }
  }
  return results;
}

// Helper: find which question indices reference a given asset path
function findQuestionIndices(questions: unknown, assetRelPath: string): number[] {
  if (!Array.isArray(questions)) return [];
  const indices: number[] = [];
  for (let i = 0; i < questions.length; i++) {
    if (includesRefCI(JSON.stringify(questions[i]), assetRelPath)) indices.push(i);
  }
  return indices;
}

// GET /api/backend/asset-usages — find games that reference a given asset path
app.get('/api/backend/color-profile', async (req, res) => {
  const { image } = req.query as { image?: string };
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Missing "image" query parameter' });
  }
  const relPath = image.replace(/^\/+images\/+/, '');
  try {
    const colors = await getColorProfile(categoryDir('images'), relPath);
    res.json({ colors });
  } catch (err) {
    res.status(500).json({ error: `Failed to read color profile: ${(err as Error).message}` });
  }
});

app.get('/api/backend/asset-usages', async (req, res) => {
  const { category, file: rawFile } = req.query as { category?: string; file?: string };
  if (!category || !rawFile || !isSafeCategory(category)) return res.json({ games: [] });
  // Normalize input to NFC: macOS readdir hands NFD strings to the frontend, which
  // echoes them back here. JSONs are NFC, so an NFD relPath fails the substring match.
  const file = rawFile.normalize('NFC');
  // Search using the relative path (no leading slash). It's a substring of both
  // canonical "/<category>/<file>" and leading-slash-less "<category>/<file>"
  // references — so .includes() picks up either form. See pathRefMatches.
  const relPath = `${category}/${file}`;
  try {
    const gameFiles = (await readdir(GAMES_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_') && !f.includes('.fingerprints.'));
    const usages: { fileName: string; title: string; instance?: string; markers?: { start?: number; end?: number }[]; questionIndices?: number[] }[] = [];
    for (const gf of gameFiles) {
      try {
        const data = await readFile(path.join(GAMES_DIR, gf), 'utf8');
        if (!includesRefCI(data, relPath)) continue;
        const content = JSON.parse(data);
        const fileName = gf.replace('.json', '');
        const title = content.title || gf;
        if (content.instances && typeof content.instances === 'object') {
          // One entry per matching instance with that instance's own markers
          for (const [instKey, instContent] of Object.entries(content.instances as Record<string, unknown>)) {
            if (!includesRefCI(JSON.stringify(instContent), relPath)) continue;
            const questions = instContent && typeof instContent === 'object' ? (instContent as Record<string, unknown>).questions : [];
            const markers = scanQuestionsForMarkers(questions, relPath);
            const questionIndices = findQuestionIndices(questions, relPath);
            usages.push({ fileName, title, instance: instKey, ...(markers.length ? { markers } : {}), ...(questionIndices.length ? { questionIndices } : {}) });
          }
        } else {
          const markers = scanQuestionsForMarkers(content.questions, relPath);
          const questionIndices = findQuestionIndices(content.questions, relPath);
          usages.push({ fileName, title, ...(markers.length ? { markers } : {}), ...(questionIndices.length ? { questionIndices } : {}) });
        }
      } catch (err) {
        console.warn(`Skipping invalid game file "${gf}" during usage search: ${(err as Error).message}`);
      }
    }
    res.json({ games: usages });
  } catch (err) {
    res.status(500).json({ error: `Failed to search usages: ${(err as Error).message}` });
  }
});

// GET /api/backend/asset-folder-usages — find game references for any file inside a folder.
// Single-call alternative to looping `asset-usages` per file: walks the folder once,
// reads each game JSON once, then substring-matches every folder file against every game.
// Aborts the walk at FOLDER_USAGE_FILE_CAP to bound work on pathological dumps.
const FOLDER_USAGE_FILE_CAP = 5000;
app.get('/api/backend/asset-folder-usages', async (req, res) => {
  const { category, folder } = req.query as { category?: string; folder?: string };
  if (!category || !folder || !isSafeCategory(category) || !isSafePath(folder)) {
    return res.json({ truncated: false, files: [] });
  }
  const catDir = categoryDir(category);
  const folderDir = path.join(catDir, folder);
  try {
    const st = await stat(folderDir);
    if (!st.isDirectory()) return res.status(400).json({ error: 'Not a directory' });
  } catch {
    return res.status(404).json({ error: 'Folder not found' });
  }

  // Recursively collect file paths relative to the category root (e.g. `audio-2024/sub/song.mp3`).
  // Mirrors the dotfile/hidden filtering applied elsewhere (see walkFiles).
  const folderFiles: string[] = [];
  let truncated = false;
  async function walk(current: string): Promise<void> {
    if (truncated) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (truncated) return;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        if (folderFiles.length >= FOLDER_USAGE_FILE_CAP) { truncated = true; return; }
        // Normalize to NFC: see listFolderRecursive — readdir on macOS returns NFD,
        // game JSONs are NFC, so the substring scan below would otherwise miss.
        folderFiles.push(path.relative(catDir, full).normalize('NFC'));
      }
    }
  }
  try {
    await walk(folderDir);
  } catch (err) {
    return res.status(500).json({ error: `Failed to walk folder: ${(err as Error).message}` });
  }
  if (truncated) {
    return res.json({ truncated: true, files: [] });
  }

  // Per-question relPath form expected by pathRefMatches/scanQuestionsForMarkers.
  const relPaths = folderFiles.map(f => `${category}/${f}`);
  const perFile = new Map<string, { fileName: string; title: string; instance?: string; markers?: { start?: number; end?: number }[]; questionIndices?: number[] }[]>();

  try {
    const gameFiles = (await readdir(GAMES_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_') && !f.includes('.fingerprints.'));
    for (const gf of gameFiles) {
      let data: string;
      try { data = await readFile(path.join(GAMES_DIR, gf), 'utf8'); }
      catch (err) { console.warn(`Skipping unreadable game file "${gf}" during folder usage search: ${(err as Error).message}`); continue; }
      // Cheap top-level reject: any reference to this category at all? Skip if not.
      if (!data.includes(`${category}/`)) continue;
      let content: Record<string, unknown>;
      try { content = JSON.parse(data) as Record<string, unknown>; }
      catch (err) { console.warn(`Skipping invalid game file "${gf}" during folder usage search: ${(err as Error).message}`); continue; }
      const fileName = gf.replace('.json', '');
      const title = typeof content.title === 'string' ? content.title : gf;
      for (const relPath of relPaths) {
        if (!data.includes(relPath)) continue;
        if (content.instances && typeof content.instances === 'object') {
          for (const [instKey, instContent] of Object.entries(content.instances as Record<string, unknown>)) {
            if (!JSON.stringify(instContent).includes(relPath)) continue;
            const questions = instContent && typeof instContent === 'object' ? (instContent as Record<string, unknown>).questions : [];
            const markers = scanQuestionsForMarkers(questions, relPath);
            const questionIndices = findQuestionIndices(questions, relPath);
            const arr = perFile.get(relPath) ?? [];
            arr.push({ fileName, title, instance: instKey, ...(markers.length ? { markers } : {}), ...(questionIndices.length ? { questionIndices } : {}) });
            perFile.set(relPath, arr);
          }
        } else {
          const markers = scanQuestionsForMarkers(content.questions, relPath);
          const questionIndices = findQuestionIndices(content.questions, relPath);
          const arr = perFile.get(relPath) ?? [];
          arr.push({ fileName, title, ...(markers.length ? { markers } : {}), ...(questionIndices.length ? { questionIndices } : {}) });
          perFile.set(relPath, arr);
        }
      }
    }
  } catch (err) {
    return res.status(500).json({ error: `Failed to search folder usages: ${(err as Error).message}` });
  }

  // Strip the `${category}/` prefix so `file` is relative to the category root, matching
  // the path form the frontend uses for folder/file references in the DAM.
  const files = Array.from(perFile.entries()).map(([relPath, games]) => ({
    file: relPath.slice(category.length + 1),
    games,
  }));
  res.json({ truncated: false, files });
});

// POST /api/backend/asset-usages-bulk — bulk variant of asset-usages for the DAM
// delete-confirm modal: takes an explicit list of category-relative file paths and
// scans every game JSON once, substring-matching all paths in one pass. Replaces the
// pre-existing N-parallel GET fan-out (which capped at 50 files and re-read every
// game JSON N times). Response shape mirrors asset-folder-usages so the frontend can
// reuse the same TypeScript type.
const FILES_USAGE_BATCH_CAP = 5000;
app.post('/api/backend/asset-usages-bulk', async (req, res) => {
  const body = req.body as { category?: string; files?: unknown };
  const category = body.category;
  const rawFiles = body.files;
  if (!category || !isSafeCategory(category) || !Array.isArray(rawFiles)) {
    return res.json({ truncated: false, files: [] });
  }
  if (rawFiles.length > FILES_USAGE_BATCH_CAP) {
    return res.json({ truncated: true, files: [] });
  }
  const inputFiles: string[] = [];
  for (const entry of rawFiles) {
    if (typeof entry !== 'string' || !isSafePath(entry)) {
      return res.status(400).json({ error: `Invalid file path: ${String(entry)}` });
    }
    // NFC: see /asset-usages — incoming paths may be NFD on macOS, JSONs are NFC.
    inputFiles.push(entry.normalize('NFC'));
  }
  if (inputFiles.length === 0) {
    return res.json({ truncated: false, files: [] });
  }

  const relPaths = inputFiles.map(f => `${category}/${f}`);
  const perFile = new Map<string, { fileName: string; title: string; instance?: string; markers?: { start?: number; end?: number }[]; questionIndices?: number[] }[]>();

  try {
    const gameFiles = (await readdir(GAMES_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_') && !f.includes('.fingerprints.'));
    for (const gf of gameFiles) {
      let data: string;
      try { data = await readFile(path.join(GAMES_DIR, gf), 'utf8'); }
      catch (err) { console.warn(`Skipping unreadable game file "${gf}" during bulk usage search: ${(err as Error).message}`); continue; }
      if (!includesRefCI(data, `${category}/`)) continue;
      let content: Record<string, unknown>;
      try { content = JSON.parse(data) as Record<string, unknown>; }
      catch (err) { console.warn(`Skipping invalid game file "${gf}" during bulk usage search: ${(err as Error).message}`); continue; }
      const fileName = gf.replace('.json', '');
      const title = typeof content.title === 'string' ? content.title : gf;
      for (const relPath of relPaths) {
        if (!includesRefCI(data, relPath)) continue;
        if (content.instances && typeof content.instances === 'object') {
          for (const [instKey, instContent] of Object.entries(content.instances as Record<string, unknown>)) {
            if (!includesRefCI(JSON.stringify(instContent), relPath)) continue;
            const questions = instContent && typeof instContent === 'object' ? (instContent as Record<string, unknown>).questions : [];
            const markers = scanQuestionsForMarkers(questions, relPath);
            const questionIndices = findQuestionIndices(questions, relPath);
            const arr = perFile.get(relPath) ?? [];
            arr.push({ fileName, title, instance: instKey, ...(markers.length ? { markers } : {}), ...(questionIndices.length ? { questionIndices } : {}) });
            perFile.set(relPath, arr);
          }
        } else {
          const markers = scanQuestionsForMarkers(content.questions, relPath);
          const questionIndices = findQuestionIndices(content.questions, relPath);
          const arr = perFile.get(relPath) ?? [];
          arr.push({ fileName, title, ...(markers.length ? { markers } : {}), ...(questionIndices.length ? { questionIndices } : {}) });
          perFile.set(relPath, arr);
        }
      }
    }
  } catch (err) {
    return res.status(500).json({ error: `Failed to search bulk usages: ${(err as Error).message}` });
  }

  const files = Array.from(perFile.entries()).map(([relPath, games]) => ({
    file: relPath.slice(category.length + 1),
    games,
  }));
  res.json({ truncated: false, files });
});

// GET /api/backend/asset-category-usages — list every file in a category that is referenced
// by any game JSON. Used by the DAM "Verwendet / Unbenutzt" filter to hide files based on
// whether they appear in any game. Walks the whole category root in one pass; aborts at
// FOLDER_USAGE_FILE_CAP to keep work bounded on pathological dumps.
app.get('/api/backend/asset-category-usages', async (req, res) => {
  const { category } = req.query as { category?: string };
  if (!category || !isSafeCategory(category)) {
    return res.json({ truncated: false, usedFiles: [], imageGuessFiles: [] });
  }
  const catDir = categoryDir(category);

  const allFiles: string[] = [];
  let truncated = false;
  async function walk(current: string): Promise<void> {
    if (truncated) return;
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (truncated) return;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        if (allFiles.length >= FOLDER_USAGE_FILE_CAP) { truncated = true; return; }
        // NFC: see listFolderRecursive — macOS readdir is NFD, JSONs are NFC.
        allFiles.push(path.relative(catDir, full).normalize('NFC'));
      }
    }
  }
  try {
    await walk(catDir);
  } catch (err) {
    return res.status(500).json({ error: `Failed to walk category: ${(err as Error).message}` });
  }
  if (truncated) {
    return res.json({ truncated: true, usedFiles: [], imageGuessFiles: [] });
  }

  const used = new Set<string>();
  // Subset of `used` that appears in any image-guess-typed game; powers the per-image
  // "Niedrige Auflösung" threshold (1920×648 vs 1920×540). Only meaningful when
  // category === 'images'; emitted as an empty array otherwise so the contract stays
  // uniform. The top-level `type` field on a game JSON is the discriminator — multi-
  // instance games inherit the same type across instances.
  const imageGuess = new Set<string>();
  try {
    const gameFiles = (await readdir(GAMES_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_') && !f.includes('.fingerprints.'));
    const gameContents: { type: string; data: string }[] = [];
    for (const gf of gameFiles) {
      try {
        const data = await readFile(path.join(GAMES_DIR, gf), 'utf8');
        if (!includesRefCI(data, `${category}/`)) continue;
        let type = '';
        try { type = ((JSON.parse(data) as { type?: unknown }).type as string | undefined) ?? ''; }
        catch { /* malformed JSON — still match by substring, just no type info */ }
        gameContents.push({ type, data });
      } catch (err) {
        console.warn(`Skipping unreadable game file "${gf}" during category usage search: ${(err as Error).message}`);
      }
    }
    const trackImageGuess = category === 'images';
    for (const rel of allFiles) {
      const relPath = `${category}/${rel}`;
      for (const { type, data } of gameContents) {
        if (!includesRefCI(data, relPath)) continue;
        used.add(rel);
        if (trackImageGuess && type === 'image-guess') imageGuess.add(rel);
      }
    }
  } catch (err) {
    return res.status(500).json({ error: `Failed to search category usages: ${(err as Error).message}` });
  }

  res.json({ truncated: false, usedFiles: Array.from(used), imageGuessFiles: Array.from(imageGuess) });
});

// POST /api/backend/assets/:category/move — rename/move file/folder and rewrite game references.
// When `toCategory` is provided and differs from `:category`, moves across categories (only the
// `audio` ↔ `background-music` pair is permitted).
app.post('/api/backend/assets/:category/move', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const { from, to, toCategory: toCategoryRaw } = req.body as { from?: string; to?: string; toCategory?: string };
  if (!from || !to || !isSafePath(from) || !isSafePath(to)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  let toCategory: AssetCategory = category;
  if (toCategoryRaw !== undefined && toCategoryRaw !== category) {
    if (!isSafeCategory(toCategoryRaw)) return res.status(400).json({ error: 'Invalid toCategory' });
    const pair = new Set([category, toCategoryRaw]);
    if (!(pair.has('audio') && pair.has('background-music') && pair.size === 2)) {
      return res.status(400).json({ error: 'Kategorieübergreifendes Verschieben nur zwischen audio und background-music erlaubt' });
    }
    if (category === 'audio' && isReservedAudioSubpath(from)) {
      return res.status(400).json({ error: 'Reservierte Ordner (bandle, backup) können nicht verschoben werden' });
    }
    toCategory = toCategoryRaw;
  }
  const fromFull = path.join(categoryDir(category), from);
  const toFull = path.join(categoryDir(toCategory), to);
  try {
    // Guard folder self/descendant moves. If `from` is a directory, reject any `to`
    // path that equals it or sits under it — the filesystem rename would otherwise
    // succeed on macOS (producing an infinite-loop-looking tree) or fail opaquely.
    let fromIsDir = false;
    try { fromIsDir = (await stat(fromFull)).isDirectory(); } catch { /* doesn't exist */ }
    if (fromIsDir && (toFull === fromFull || toFull.startsWith(fromFull + path.sep))) {
      return res.status(400).json({ error: 'Ordner kann nicht in sich selbst verschoben werden' });
    }
    // Check if destination already exists as a directory (naming collision).
    // This happens when moving the last file out of a folder that shares the file's name,
    // e.g. moving "Foo/Foo.jpg" to root — toFull "Foo.jpg" is still a directory at this point.
    let destIsDir = false;
    let destIsFile = false;
    let destInode: { dev: number; ino: number } | null = null;
    try {
      const destStat = await stat(toFull);
      destIsDir = destStat.isDirectory();
      destIsFile = destStat.isFile();
      destInode = { dev: destStat.dev, ino: destStat.ino };
    } catch { /* toFull doesn't exist */ }

    // Block overwrite: if destination is a file and points to a different
    // inode than source, refuse instead of silently clobbering it. On
    // case-insensitive filesystems a case-only rename stats the same inode —
    // allow those through.
    if (destIsFile) {
      let sameInode = false;
      try {
        const fromStat = await stat(fromFull);
        sameInode = !!destInode && fromStat.dev === destInode.dev && fromStat.ino === destInode.ino;
      } catch { /* fromFull missing — fall through to rename which will error */ }
      if (!sameInode) {
        return res.status(409).json({ error: `Der Name "${path.basename(to)}" ist bereits vergeben` });
      }
    }

    if (destIsDir) {
      const tmpPath = `${toFull}.__moving__`;
      await rename(fromFull, tmpPath);
      try {
        const remaining = await readdir(path.dirname(fromFull));
        if (remaining.length === 0) await rm(path.dirname(fromFull), { recursive: true });
      } catch { /* ignore cleanup errors */ }
      await rename(tmpPath, toFull);
    } else {
      await mkdir(path.dirname(toFull), { recursive: true });
      await rename(fromFull, toFull);
    }

    // Update the video-reference registry if a reference is being renamed/moved inside
    // the videos category. Skip the NAS-move queue for references — they never exist
    // on the NAS. See specs/video-references.md.
    let wasReference = false;
    if (category === 'videos' && toCategory === 'videos') {
      const references = await getReferenceMapCached();
      if (references[from]) {
        await renameVideoReferenceEntry(categoryDir('videos'), from, to);
        invalidateReferenceMapCache();
        wasReference = true;
      }
    }
    if (!wasReference) {
      if (toCategory === category) {
        queueNasMove(category, from, to);
      } else {
        queueNasMoveCross(category, from, toCategory, to);
      }
    }

    if (category === 'videos' || toCategory === 'videos') { invalidateVideoFilesCache(); _storageStatsCache = null; }

    // Rewrite game references: replace /<category>/<from> → /<toCategory>/<to>
    const fromUrl = `/${category}/${from}`;
    const toUrl = `/${toCategory}/${to}`;
    const gameFiles = (await readdir(GAMES_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_') && !f.includes('.fingerprints.'));
    for (const gf of gameFiles) {
      const fp = path.join(GAMES_DIR, gf);
      const data = await readFile(fp, 'utf8');
      if (includesRefCI(data, fromUrl)) {
        const tmpPath = `${fp}.tmp`;
        await writeFile(tmpPath, replaceRefCI(data, fromUrl, toUrl), 'utf8');
        await rename(tmpPath, fp);
      }
    }
    // Audio rename: also rename the derived cover at /images/Audio-Covers/{basename}.jpg
    // and its meta entry, plus any stale YouTube Thumbnails/ sibling, and rewrite the
    // cover path across game JSONs. Skips directory moves (fromIsDir) — those don't
    // change audio basenames. Skips cross-category moves to background-music (no covers).
    if (!fromIsDir && category === 'audio' && toCategory === 'audio') {
      const fromBase = path.basename(from);
      const toBase = path.basename(to);
      if (fromBase !== toBase) {
        const imagesDir = categoryDir('images');
        const oldCover = audioCoverFilename(fromBase);
        const newCover = audioCoverFilename(toBase);
        const oldCoverFull = path.join(imagesDir, AUDIO_COVERS_SUBDIR, oldCover);
        const newCoverFull = path.join(imagesDir, AUDIO_COVERS_SUBDIR, newCover);
        if (existsSync(oldCoverFull) && !existsSync(newCoverFull)) {
          await rename(oldCoverFull, newCoverFull);
          queueNasMove('images', `${AUDIO_COVERS_SUBDIR}/${oldCover}`, `${AUDIO_COVERS_SUBDIR}/${newCover}`);
          broadcastAssetsChanged('images');
        }
        // Stale archival YT thumbnail (pre-migration layouts only)
        const oldYtFull = path.join(imagesDir, AUDIO_COVERS_SUBDIR, 'YouTube Thumbnails', oldCover);
        const newYtFull = path.join(imagesDir, AUDIO_COVERS_SUBDIR, 'YouTube Thumbnails', newCover);
        if (existsSync(oldYtFull) && !existsSync(newYtFull)) {
          await rename(oldYtFull, newYtFull);
        }
        await renameAudioCoverMeta(imagesDir, oldCover, newCover);
        // Rewrite any game JSON that references the old cover path.
        const oldCoverUrl = `/images/${AUDIO_COVERS_SUBDIR}/${oldCover}`;
        const newCoverUrl = `/images/${AUDIO_COVERS_SUBDIR}/${newCover}`;
        for (const gf of gameFiles) {
          const fp = path.join(GAMES_DIR, gf);
          const data = await readFile(fp, 'utf8');
          if (includesRefCI(data, oldCoverUrl)) {
            const tmpPath = `${fp}.tmp`;
            await writeFile(tmpPath, replaceRefCI(data, oldCoverUrl, newCoverUrl), 'utf8');
            await rename(tmpPath, fp);
          }
        }
      }
    }
    broadcastAssetsChanged(category as AssetCategory);
    if (toCategory !== category) broadcastAssetsChanged(toCategory);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to move: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/:category/hashes — compute MD5 hashes for a list of files.
// Used by the DAM deduplication UI to compare files before merging.
app.post('/api/backend/assets/:category/hashes', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const { files: filePaths } = req.body as { files?: string[] };
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return res.status(400).json({ error: 'files must be a non-empty array' });
  }
  if (filePaths.some(f => typeof f !== 'string' || !isSafePath(f))) {
    return res.status(400).json({ error: 'Invalid file path' });
  }
  const dir = categoryDir(category);
  try {
    const hashes: Record<string, string> = {};
    await Promise.all(filePaths.map(async (f) => {
      const full = path.join(dir, f);
      hashes[f] = await fileHash(full);
    }));
    res.json({ hashes });
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'File not found'
      : `Failed to hash: ${(err as Error).message}`;
    res.status(500).json({ error: msg });
  }
});

// Rewrite `/{cat}/{from}` → `/{cat}/{to}` across every non-template `games/*.json`
// file. Used by the merge and replace endpoints. Returns the number of files
// that contained at least one occurrence.
async function rewriteGameRefs(cat: string, from: string, to: string): Promise<number> {
  const fromUrl = `/${cat}/${from}`;
  const toUrl = `/${cat}/${to}`;
  const gameFiles = (await readdir(GAMES_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_') && !f.includes('.fingerprints.'));
  let rewritten = 0;
  for (const gf of gameFiles) {
    const fp = path.join(GAMES_DIR, gf);
    const data = await readFile(fp, 'utf8');
    if (includesRefCI(data, fromUrl)) {
      const tmpPath = `${fp}.tmp`;
      await writeFile(tmpPath, replaceRefCI(data, fromUrl, toUrl), 'utf8');
      await rename(tmpPath, fp);
      rewritten++;
    }
  }
  return rewritten;
}

// POST /api/backend/assets/:category/merge — merge two duplicate assets:
// rewrite every game reference to the discarded path → kept path, delete the
// discarded file, and (for images) register an alias so auto-downloaders skip
// recreating the discarded filename. For audio/videos, cascade the merge to
// the auto-derived cover/poster when both exist.
app.post('/api/backend/assets/:category/merge', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const { keep, discard } = req.body as { keep?: string; discard?: string };
  if (!keep || !discard || !isSafePath(keep) || !isSafePath(discard)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  if (keep === discard) return res.status(400).json({ error: 'keep and discard must differ' });

  const dir = categoryDir(category);
  const keepFull = path.join(dir, keep);
  const discardFull = path.join(dir, discard);
  const imagesDir = categoryDir('images');

  try {
    const [keepStat, discardStat] = await Promise.all([stat(keepFull), stat(discardFull)]);
    if (!keepStat.isFile() || !discardStat.isFile()) {
      return res.status(400).json({ error: 'Both paths must be files' });
    }

    const rewrittenGames = await rewriteGameRefs(category, discard, keep);
    await rm(discardFull);
    queueNasDelete(category, discard);

    if (category === 'videos') { invalidateVideoFilesCache(); _storageStatsCache = null; }

    // For images: record an alias so auto-downloaders skip regenerating the
    // discarded basename. Keys are basenames (matching auto-downloader output).
    if (category === 'images') {
      await addAssetAlias(imagesDir, path.basename(discard), path.basename(keep));
    }

    // Cascade: if merging audio/video, and both have auto-derived covers/posters,
    // merge those too.
    let cascadedCover: { keep: string; discard: string } | undefined;
    if (category === 'audio' || category === 'videos') {
      const subdir = category === 'audio' ? AUDIO_COVERS_SUBDIR : MOVIE_POSTERS_SUBDIR;
      const keepCover = category === 'audio'
        ? audioCoverFilename(path.basename(keep))
        : `${videoFilenameToSlug(path.basename(keep))}.jpg`;
      const discardCover = category === 'audio'
        ? audioCoverFilename(path.basename(discard))
        : `${videoFilenameToSlug(path.basename(discard))}.jpg`;
      if (keepCover && discardCover && keepCover !== discardCover) {
        const keepCoverFull = path.join(imagesDir, subdir, keepCover);
        const discardCoverFull = path.join(imagesDir, subdir, discardCover);
        if (existsSync(keepCoverFull) && existsSync(discardCoverFull)) {
          const coverKeepRel = `${subdir}/${keepCover}`;
          const coverDiscardRel = `${subdir}/${discardCover}`;
          await rewriteGameRefs('images', coverDiscardRel, coverKeepRel);
          await rm(discardCoverFull);
          queueNasDelete('images', coverDiscardRel);
          await addAssetAlias(imagesDir, discardCover, keepCover);
          if (category === 'audio') await deleteAudioCoverMeta(imagesDir, discardCover);
          cascadedCover = { keep: coverKeepRel, discard: coverDiscardRel };
        }
      }
    }

    broadcastAssetsChanged(category as AssetCategory);
    if (cascadedCover) broadcastAssetsChanged('images');
    res.json({ success: true, rewrittenGames, ...(cascadedCover ? { cascadedCover } : {}) });
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'File not found'
      : `Failed to merge: ${(err as Error).message}`;
    res.status(500).json({ error: msg });
  }
});

// ── Image search + replace (DAM "Ersetzen" flow) ────────────────────────────
//
// `images/search` runs the query against three free, no-API-key providers
// (DuckDuckGo, Wikimedia Commons, OpenVerse) in parallel and merges the
// results. `images/replace` swaps the bytes of an existing image atomically,
// backs the old bytes up to `.replace-backups/`, and — when the file format
// changes — rewrites every game-config reference via `rewriteGameRefs`.
//
// See specs/dam-image-replace.md.

const REPLACE_BACKUPS_SUBDIR = '.replace-backups';
const REPLACE_BACKUPS_PER_BASENAME = 5;

// Per-path async mutex so two concurrent replaces of the same target don't
// race the .tmp + rename swap.
const replaceInFlight = new Map<string, Promise<void>>();
async function withReplaceMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = replaceInFlight.get(key);
  if (prev) await prev.catch(() => {});
  let resolveOuter!: () => void;
  const gate = new Promise<void>(r => { resolveOuter = r; });
  replaceInFlight.set(key, gate);
  try {
    return await fn();
  } finally {
    resolveOuter();
    if (replaceInFlight.get(key) === gate) replaceInFlight.delete(key);
  }
}

async function pruneReplaceBackups(backupsDir: string, basename: string): Promise<void> {
  let entries: string[];
  try { entries = await readdir(backupsDir); } catch { return; }
  const prefix = `${basename}.`;
  const matching = entries.filter(e => e.startsWith(prefix));
  if (matching.length <= REPLACE_BACKUPS_PER_BASENAME) return;
  const withMtime = await Promise.all(matching.map(async name => {
    try {
      const st = await stat(path.join(backupsDir, name));
      return { name, mtimeMs: st.mtimeMs };
    } catch { return { name, mtimeMs: 0 }; }
  }));
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const entry of withMtime.slice(REPLACE_BACKUPS_PER_BASENAME)) {
    await unlink(path.join(backupsDir, entry.name)).catch(() => {});
  }
}

// Shared "swap bytes" tail used by both POST /images/replace and POST /images/upscale.
// Atomic write under per-path mutex; backup the old bytes; if the extension changed,
// rewrite every game reference and alias the old basename to the new one; invalidate
// the dimension + color-profile + storage-stats caches; NAS-sync; broadcast.
interface PerformImageReplaceArgs {
  targetFull: string;
  target: string;             // relative posix path under images/
  targetBasename: string;
  targetExt: string;          // includes leading '.' e.g. '.jpg'
  targetDir: string;
  imagesDir: string;
  oldBytes: Buffer;
  oldMtimeMs: number;
  oldSize: number;
  oldDims?: { w: number; h: number };
  newBytes: Buffer;
  newDims: { w: number; h: number } | null;
  newBasename: string;
  newFull: string;
  newRel: string;
  extensionChanged: boolean;
}

interface PerformImageReplaceResult {
  success: true;
  target: string;
  newFilename: string;
  oldDims?: { w: number; h: number };
  newDims: { w: number; h: number };
  oldSize: number;
  newSize: number;
  extensionChanged: boolean;
  rewrittenGames: number;
  backupPath: string;
  version: number;
}

async function performImageReplace(args: PerformImageReplaceArgs): Promise<PerformImageReplaceResult> {
  const {
    targetFull, target, targetBasename, targetExt, imagesDir,
    oldBytes, oldMtimeMs, oldSize, oldDims,
    newBytes, newDims, newBasename, newFull, newRel, extensionChanged,
  } = args;
  return await withReplaceMutex(targetFull, async () => {
    const backupsDir = path.join(imagesDir, REPLACE_BACKUPS_SUBDIR);
    await mkdir(backupsDir, { recursive: true });
    const backupName = `${targetBasename}.${oldMtimeMs}${targetExt}`;
    const backupPath = path.join(backupsDir, backupName);
    await writeFile(backupPath, oldBytes);
    await pruneReplaceBackups(backupsDir, targetBasename);

    // Atomic write of new bytes to a .tmp sibling, then rename.
    const tmpPath = `${newFull}.replace.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tmpPath, newBytes);
      await rename(tmpPath, newFull);
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw err;
    }

    let rewrittenGames = 0;
    if (extensionChanged) {
      const fromRel = target.replace(/\\/g, '/');
      const toRel = newRel;
      rewrittenGames = await rewriteGameRefs('images', fromRel, toRel);
      if (path.resolve(targetFull) !== path.resolve(newFull)) {
        await unlink(targetFull).catch(() => {});
        queueNasDelete('images', target);
      }
      await addAssetAlias(imagesDir, targetBasename, newBasename);
    }

    _storageStatsCache = null;
    const versionStat = await stat(newFull);
    await probeImageDimensions(newFull, versionStat.mtimeMs).catch(() => {});
    if (isSupportedImageForColorProfile(newBasename)) {
      warmColorProfile(imagesDir, newRel);
    }
    queueNasCopy('images', newRel);
    broadcastAssetsChanged('images');

    const finalNewDims = newDims ?? { w: 0, h: 0 };

    return {
      success: true as const,
      target,
      newFilename: newRel,
      ...(oldDims ? { oldDims } : {}),
      newDims: finalNewDims,
      oldSize,
      newSize: newBytes.length,
      extensionChanged,
      rewrittenGames,
      backupPath: path.posix.join(REPLACE_BACKUPS_SUBDIR, backupName),
      version: versionStat.mtimeMs,
    };
  });
}

// POST /api/backend/assets/images/search — multi-provider image search.
app.post('/api/backend/assets/images/search', async (req, res) => {
  const { query, limit, providers, page } = req.body as {
    query?: string;
    limit?: number;
    providers?: ImageSearchProvider[];
    page?: number;
  };
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Missing query' });
  }
  try {
    const result = await searchImagesOrchestrator({
      query,
      limit: typeof limit === 'number' ? limit : undefined,
      providers: Array.isArray(providers) ? providers : undefined,
      page: typeof page === 'number' ? page : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: 'all_providers_failed', message: (err as Error).message });
  }
});

// POST /api/backend/assets/youtube/search — keyword search YouTube via yt-dlp.
// Returns metadata-only results (no download); the chosen result is downloaded
// later through the existing /assets/:category/youtube-download route. Literal
// `youtube` segment — does not collide with the `:category` routes.
app.post('/api/backend/assets/youtube/search', async (req, res) => {
  const { query, limit, page } = req.body as {
    query?: string;
    limit?: number;
    page?: number;
  };
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Missing query' });
  }
  // Abort the yt-dlp search when the client disconnects — e.g. the user fixed a
  // typo and the panel superseded this request — so we don't leave a doomed
  // process running.
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  try {
    const result = await searchYouTube({
      query,
      limit: typeof limit === 'number' ? limit : undefined,
      page: typeof page === 'number' ? page : undefined,
      signal: ac.signal,
    });
    res.json(result);
  } catch (err) {
    if (ac.signal.aborted) return; // client gone — nothing to send
    res.status(502).json({ error: 'youtube_search_failed', message: (err as Error).message });
  }
});

// POST /api/backend/assets/images/replace — atomically replace an image's bytes.
app.post('/api/backend/assets/images/replace', upload.single('file'), async (req, res) => {
  const body = (req.body || {}) as {
    target?: string;
    url?: string;
    force?: boolean | string;
    dryRun?: boolean | string;
  };
  const target = typeof body.target === 'string' ? body.target : '';
  const url = typeof body.url === 'string' ? body.url : '';
  const force = body.force === true || body.force === 'true' || body.force === '1';
  const dryRun = body.dryRun === true || body.dryRun === 'true' || body.dryRun === '1';

  if (!target || !isSafePath(target)) {
    return res.status(400).json({ error: 'invalid_target' });
  }

  const imagesDir = categoryDir('images');
  const targetFull = path.join(imagesDir, target);
  const targetDir = path.dirname(targetFull);
  const targetBasename = path.basename(target);
  const targetExt = path.extname(targetBasename).toLowerCase();

  // 1. Read the new bytes (multipart, JSON-URL, or error).
  let newBytes: Buffer;
  try {
    if (req.file) {
      newBytes = await readFile(req.file.path);
      await unlink(req.file.path).catch(() => {});
    } else if (url) {
      const fetched = await fetchImageBytesFromUrl(url);
      newBytes = fetched.buffer;
    } else {
      return res.status(400).json({ error: 'missing_source', message: 'Either `file` (multipart) or `url` (JSON) is required.' });
    }
  } catch (err) {
    if (req.file) await unlink(req.file.path).catch(() => {});
    return res.status(502).json({ error: 'fetch_failed', message: (err as Error).message });
  }

  if (newBytes.length === 0) {
    return res.status(400).json({ error: 'not_an_image', message: 'Empty payload.' });
  }

  const sniffedExt = sniffImageExt(newBytes);
  if (!sniffedExt) {
    return res.status(400).json({ error: 'not_an_image' });
  }

  // 2. Validate target exists and capture old metadata.
  let targetStat;
  try { targetStat = await stat(targetFull); }
  catch { return res.status(400).json({ error: 'invalid_target', message: 'Target file does not exist.' }); }
  if (!targetStat.isFile()) {
    return res.status(400).json({ error: 'invalid_target', message: 'Target is not a file.' });
  }
  const oldBytes = await readFile(targetFull);
  const oldMtimeMs = targetStat.mtimeMs;
  const oldSize = targetStat.size;

  // 3. SVG ↔ raster mismatch — needs explicit force (Trotzdem ersetzen),
  // mirrors the smaller-image guard below. 409 carries the old/new extension
  // so the client can build a directional warning ("PNG → SVG" vs "SVG →
  // PNG") without re-parsing the target path.
  const oldIsSvg = targetExt === '.svg';
  const newIsSvg = sniffedExt === '.svg';
  if (!force && oldIsSvg !== newIsSvg) {
    return res.status(409).json({
      error: 'vector_raster_mismatch',
      oldExt: targetExt,
      newExt: sniffedExt,
    });
  }

  // 4. Identical bytes short-circuit.
  const newHash = crypto.createHash('md5').update(newBytes).digest('hex');
  const oldHash = crypto.createHash('md5').update(oldBytes).digest('hex');
  if (newHash === oldHash) {
    return res.json({ noChange: true });
  }

  // 5. Probe old + new dims (raster only — SVG dims are intentionally unknown).
  let oldDims: { w: number; h: number } | null = null;
  if (!oldIsSvg) {
    const cached = getCachedDimensions(targetFull, oldMtimeMs);
    const dims = cached || (await probeImageDimensions(targetFull, oldMtimeMs).catch(() => undefined));
    if (dims) oldDims = { w: dims.width, h: dims.height };
  }
  let newDims: { w: number; h: number } | null = null;
  if (!newIsSvg) {
    try {
      const meta = await (await import('sharp')).default(newBytes).metadata();
      if (meta.width && meta.height) newDims = { w: meta.width, h: meta.height };
    } catch { /* sharp couldn't decode — fall through to error below */ }
    if (!newDims) {
      return res.status(400).json({ error: 'not_an_image', message: 'Bildgröße konnte nicht ermittelt werden.' });
    }
  }

  // 6. Smaller-in-both-dims guard.
  if (!force && oldDims && newDims && newDims.w < oldDims.w && newDims.h < oldDims.h) {
    return res.status(409).json({ error: 'smaller', oldDims, newDims });
  }

  // 7. Determine the new filename. Same ext → preserve; different ext → swap.
  const extensionChanged = sniffedExt !== targetExt;
  const newBasename = extensionChanged
    ? `${path.basename(targetBasename, targetExt)}${sniffedExt}`
    : targetBasename;
  const newRel = path.posix.join(
    path.dirname(target).replace(/\\/g, '/'),
    newBasename,
  ).replace(/^\.\//, '').replace(/^\//, '');
  const newFull = path.join(targetDir, newBasename);

  // Conflict: extension change would clobber a different existing file.
  if (extensionChanged && existsSync(newFull) && path.resolve(newFull) !== path.resolve(targetFull)) {
    return res.status(409).json({
      error: 'name_conflict',
      message: `Eine andere Datei namens ${newBasename} existiert bereits.`,
    });
  }

  // 8. Dry run — return the preview without writing.
  if (dryRun) {
    return res.json({
      success: true,
      target,
      newFilename: newRel,
      ...(oldDims ? { oldDims } : {}),
      newDims: newDims || { w: 0, h: 0 },
      oldSize,
      newSize: newBytes.length,
      extensionChanged,
      // We don't actually rewrite refs in dry-run; the count is the would-be count.
      rewrittenGames: 0,
      backupPath: '',
      version: oldMtimeMs,
      dryRun: true,
    });
  }

  // 9. Real swap under the per-path mutex.
  try {
    const result = await performImageReplace({
      targetFull, target, targetBasename, targetExt, targetDir, imagesDir,
      oldBytes, oldMtimeMs, oldSize,
      ...(oldDims ? { oldDims } : {}),
      newBytes, newDims,
      newBasename, newFull, newRel, extensionChanged,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'replace_failed', message: (err as Error).message });
  }
});

// ── Local-AI image upscaler ────────────────────────────────────────────────
// Wraps server/upscale.ts. Three endpoints:
//   GET  /api/backend/assets/images/upscale/info           — feature gate
//   POST /api/backend/assets/images/upscale                — dry-run preview OR confirm-replace
//   GET  /api/backend/assets/images/upscale/preview/:hash  — stream cached preview
//
// Confirm-replace reuses performImageReplace() above. The cache is in-memory only;
// preview URLs 404 after a Node restart (the client re-runs the dry-run automatically).
// See specs/dam-image-upscale.md.

app.get('/api/backend/assets/images/upscale/info', (_req, res) => {
  res.json({
    available: isUpscalerAvailable(),
    models: UPSCALE_MODELS,
    scales: UPSCALE_SCALES,
    supportedExts: UPSCALE_SUPPORTED_EXTS,
  });
});

// SSE: stream per-tile progress percents from a running upscale. The client
// generates `progressId` (a UUID), opens this stream, then POSTs to /upscale
// passing the same id in the body. Each tile completion yields a
// `data: {"percent": N}\n\n` event. The stream stays open for the lifetime
// of the upscale; the client closes it when the POST returns.
app.get('/api/backend/assets/images/upscale/progress/:progressId', (req, res) => {
  const { progressId } = req.params;
  if (!/^[a-fA-F0-9-]{36}$/.test(progressId)) {
    return res.status(400).json({ error: 'invalid_progress_id' });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(':\n\n'); // comment heartbeat so the browser flushes the response head
  const unsubscribe = setUpscaleProgressListener(progressId, (percent) => {
    res.write(`data: ${JSON.stringify({ percent })}\n\n`);
  });
  req.on('close', () => {
    unsubscribe();
    res.end();
  });
});

app.get('/api/backend/assets/images/upscale/preview/:cacheKey', (req, res) => {
  const cacheKey = req.params.cacheKey;
  if (!/^[a-f0-9]{40}-(ultramix_balanced|ultrasharp|digital_art)-(1\.5|2|3|4)x\.(jpg|png|webp)$/.test(cacheKey)) {
    return res.status(400).json({ error: 'invalid_cache_key' });
  }
  const entry = getCachedUpscale(cacheKey);
  if (!entry) return res.status(404).json({ error: 'cache_miss' });
  res.setHeader('Content-Type', entry.contentType);
  res.setHeader('Content-Length', String(entry.buffer.length));
  res.setHeader('Cache-Control', 'private, max-age=300, immutable');
  res.end(entry.buffer);
});

app.post('/api/backend/assets/images/upscale', async (req, res) => {
  const body = (req.body || {}) as {
    target?: string;
    model?: string;
    scale?: number | string;
    dryRun?: boolean | string;
    progressId?: string;
  };
  const target = typeof body.target === 'string' ? body.target : '';
  const model = body.model;
  const scale = Number(body.scale);
  const dryRun = body.dryRun === true || body.dryRun === 'true' || body.dryRun === '1';
  const progressId = typeof body.progressId === 'string' && /^[a-fA-F0-9-]{36}$/.test(body.progressId)
    ? body.progressId
    : undefined;

  if (!target || !isSafePath(target)) {
    return res.status(400).json({ error: 'invalid_target' });
  }
  if (typeof model !== 'string' || !UPSCALE_MODELS.includes(model as UpscaleModel)) {
    return res.status(400).json({ error: 'invalid_model', allowed: UPSCALE_MODELS });
  }
  if (!UPSCALE_SCALES.includes(scale as UpscaleScale)) {
    return res.status(400).json({ error: 'invalid_scale', allowed: UPSCALE_SCALES });
  }

  const imagesDir = categoryDir('images');
  const targetFull = path.join(imagesDir, target);
  const targetDir = path.dirname(targetFull);
  const targetBasename = path.basename(target);
  const targetExt = path.extname(targetBasename).toLowerCase();

  if (!(UPSCALE_SUPPORTED_EXTS as readonly string[]).includes(targetExt)) {
    return res.status(400).json({ error: 'unsupported_format', message: `AI upscaling only supports ${UPSCALE_SUPPORTED_EXTS.join(', ')}.` });
  }

  let targetStat;
  try { targetStat = await stat(targetFull); }
  catch { return res.status(400).json({ error: 'invalid_target', message: 'Target file does not exist.' }); }
  if (!targetStat.isFile()) {
    return res.status(400).json({ error: 'invalid_target', message: 'Target is not a file.' });
  }

  if (!isUpscalerAvailable()) {
    return res.status(503).json({
      error: 'not_installed',
      message: 'AI-Upscaler nicht installiert. `npm run upscaler:install` ausführen.',
    });
  }

  const inputBytes = await readFile(targetFull);

  // Cache-key dry-run hit short-circuit (skip Sharp + spawn entirely).
  const cacheKey = buildUpscaleCacheKey(inputBytes, model as UpscaleModel, scale as UpscaleScale, targetExt);
  const cached = getCachedUpscale(cacheKey);

  let upscaled;
  try {
    upscaled = cached
      ? {
          buffer: cached.buffer,
          width: cached.width,
          height: cached.height,
          contentType: cached.contentType,
          durationMs: 0,
          cacheKey,
          cached: true,
        }
      : await upscaleImage(inputBytes, {
          model: model as UpscaleModel,
          scale: scale as UpscaleScale,
          targetExt,
          ...(progressId ? { progressId } : {}),
        });
  } catch (err) {
    if (err instanceof UpscaleError) {
      return res.status(err.code === 'not_installed' ? 503 : 500).json({
        error: err.code,
        message: err.message,
      });
    }
    return res.status(500).json({ error: 'upscale_failed', message: (err as Error).message });
  }

  if (dryRun) {
    return res.json({
      success: true,
      target,
      newDims: { w: upscaled.width, h: upscaled.height },
      newSize: upscaled.buffer.length,
      previewUrl: `/api/backend/assets/images/upscale/preview/${upscaled.cacheKey}`,
      durationMs: upscaled.durationMs,
      cached: upscaled.cached,
      cacheKey: upscaled.cacheKey,
    });
  }

  // Confirm path — feed bytes through the shared replace pipeline.
  const oldMtimeMs = targetStat.mtimeMs;
  const oldSize = targetStat.size;

  // Cheap probe — should already be cached from previous DAM rendering.
  const cachedOldDims = getCachedDimensions(targetFull, oldMtimeMs);
  const oldDimsProbe = cachedOldDims || (await probeImageDimensions(targetFull, oldMtimeMs).catch(() => undefined));
  const oldDims = oldDimsProbe ? { w: oldDimsProbe.width, h: oldDimsProbe.height } : undefined;

  // Extension never changes for upscale — output format matches input format.
  try {
    const result = await performImageReplace({
      targetFull,
      target,
      targetBasename,
      targetExt,
      targetDir,
      imagesDir,
      oldBytes: inputBytes,
      oldMtimeMs,
      oldSize,
      ...(oldDims ? { oldDims } : {}),
      newBytes: upscaled.buffer,
      newDims: { w: upscaled.width, h: upscaled.height },
      newBasename: targetBasename,
      newFull: targetFull,
      newRel: target,
      extensionChanged: false,
    });
    res.json({ ...result, durationMs: upscaled.durationMs });
  } catch (err) {
    res.status(500).json({ error: 'replace_failed', message: (err as Error).message });
  }
});

// ── Cached storage & cache-dir stats for system-status (avoid re-walking on every poll) ──
let _storageStatsCache: { categories: Array<{ name: string; fileCount: number; totalSizeBytes: number }>; ts: number } | null = null;
let _cacheDirStatsCache: { sdr: { count: number; totalSizeBytes: number; files: string[] }; compressed: { count: number; totalSizeBytes: number; files: string[] }; ts: number } | null = null;
const STATUS_CACHE_TTL = 10_000; // 10s

async function getStorageStats(): Promise<Array<{ name: string; fileCount: number; totalSizeBytes: number }>> {
  if (_storageStatsCache && Date.now() - _storageStatsCache.ts < STATUS_CACHE_TTL) return _storageStatsCache.categories;
  const categoryNames = ['images', 'audio', 'background-music', 'videos', 'audio-guess'] as const;
  const categories = await Promise.all(categoryNames.map(async (name) => {
    const dir = path.join(LOCAL_ASSETS_BASE, name);
    let fileCount = 0;
    let totalSizeBytes = 0;
    async function walk(d: string): Promise<void> {
      try {
        const entries = await readdir(d, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'backup') continue;
          const full = path.join(d, e.name);
          if (e.isDirectory()) { await walk(full); }
          else if (e.isFile()) {
            fileCount++;
            try { totalSizeBytes += (await stat(full)).size; } catch { /* skip */ }
          }
        }
      } catch { /* dir doesn't exist */ }
    }
    await walk(dir);
    return { name, fileCount, totalSizeBytes };
  }));
  _storageStatsCache = { categories, ts: Date.now() };
  return categories;
}

function getCacheDirStats(): { sdr: { count: number; totalSizeBytes: number; files: string[] }; compressed: { count: number; totalSizeBytes: number; files: string[] } } {
  if (_cacheDirStatsCache && Date.now() - _cacheDirStatsCache.ts < STATUS_CACHE_TTL) return _cacheDirStatsCache;
  function scanDir(subdir: string): { count: number; totalSizeBytes: number; files: string[] } {
    const dir = path.join(VIDEO_CACHE_BASE, subdir);
    const files: string[] = [];
    let totalSizeBytes = 0;
    try {
      for (const f of readdirSync(dir)) {
        if (f.startsWith('.')) continue;
        files.push(f);
        try { totalSizeBytes += statSync(path.join(dir, f)).size; } catch { /* skip */ }
      }
    } catch { /* dir doesn't exist */ }
    return { count: files.length, totalSizeBytes, files };
  }
  const result = { sdr: scanDir('sdr'), compressed: scanDir('compressed'), ts: Date.now() };
  _cacheDirStatsCache = result;
  return result;
}

// POST /api/backend/caches/clear — wipe SDR + compressed segment caches (local + NAS mirror)
// and the HDR metadata cache (in-memory Map + hdr.json). Skips .tmp (active encodes) and
// dotfiles. Caches regenerate on demand, so this is non-destructive beyond one-time latency.
app.post('/api/backend/caches/clear', (_req, res) => {
  const cleared = { sdr: 0, compressed: 0, hdr: 0 };
  for (const subdir of ['sdr', 'compressed'] as const) {
    for (const base of [VIDEO_CACHE_BASE, NAS_CACHE_BASE]) {
      const dir = path.join(base, subdir);
      let entries: string[];
      try { entries = readdirSync(dir); } catch { continue; }
      for (const f of entries) {
        if (f.startsWith('.') || f.endsWith('.tmp')) continue;
        try {
          unlinkSync(path.join(dir, f));
          if (base === VIDEO_CACHE_BASE) cleared[subdir]++;
        } catch { /* already gone */ }
      }
    }
  }
  cleared.hdr = hdrCache.size;
  hdrCache.clear();
  try { unlinkSync(HDR_CACHE_FILE); } catch { /* already gone */ }
  sdrCacheReady.clear();
  compressedCacheReady.clear();
  invalidateCacheDirStats();
  // Tell admin clients to drop any "cache ready" state they're holding locally —
  // otherwise the VideoGuessForm keeps showing questions as cached and the "Cache
  // erstellen" button stays disabled until the next reorder or page reload.
  broadcast('caches-cleared', { ts: Date.now() });
  res.json({ cleared });
});

// GET /api/backend/cache-mode — current background-encoding mode (balanced | max).
// PUT /api/backend/cache-mode — flip mode. Re-prices all in-flight background
//   ffmpeg / whisper / normalize PIDs immediately via taskpolicy -p / renice -p,
//   no server restart required. See specs/server-asset-priority.md.
app.get('/api/backend/cache-mode', (_req, res) => {
  res.json({ mode: getCacheMode() });
});
app.put('/api/backend/cache-mode', (req, res) => {
  const body = req.body as { mode?: unknown } | undefined;
  const mode = body?.mode;
  if (mode !== 'balanced' && mode !== 'max') {
    return res.status(400).json({ error: 'mode must be "balanced" or "max"' });
  }
  setCacheMode(mode);
  res.json({ mode: getCacheMode() });
});

// POST /api/backend/stream-notify — frontend notifies server when video playback starts/stops
// Used to throttle NAS sync bandwidth during playback
app.post('/api/backend/stream-notify', (req, res) => {
  const { active } = req.body as { active?: boolean };
  if (active === true) _serverStreamActive++;
  else if (active === false) _serverStreamActive = Math.max(0, _serverStreamActive - 1);
  res.json({ ok: true });
});

// ── Build system-status payload (shared by HTTP endpoint and WebSocket broadcaster) ──
async function buildSystemStatusPayload(): Promise<Record<string, unknown>> {
  const nas = isNasMounted();
  const mem = process.memoryUsage();
  const ffmpegAvailable = !!FFMPEG_BIN && existsSync(FFMPEG_BIN);
  const ytDlpAvailable = existsSync(YT_DLP_BIN);
  const loadAvg = os.loadavg();
  const cpuCount = os.cpus().length;

  const [categories, cacheStats] = await Promise.all([
    getStorageStats(),
    Promise.resolve(getCacheDirStats()),
  ]);
  const sdrCache = cacheStats.sdr;
  const compressedCache = cacheStats.compressed;

  const ytDownloads = Array.from(ytDownloadJobs.values())
    .filter(j => j.phase !== 'done' && j.phase !== 'error')
    .map(j => ({
      id: j.id, title: j.title, phase: j.phase, percent: j.percent,
      playlistTotal: j.trackCount, playlistDone: j.tracks?.filter(t => t.phase === 'done').length,
      elapsed: j.startedAt ? Math.round((Date.now() - j.startedAt) / 1000) : 0,
    }));

  let activeGameshow = '—';
  let gameOrderCount = 0;
  let totalGameFiles = 0;
  try {
    const config = await loadConfig();
    activeGameshow = config.activeGameshow;
    gameOrderCount = getActiveGameOrder(config).length;
  } catch { /* config not readable */ }
  try {
    const files = await readdir(GAMES_DIR);
    totalGameFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('_template-') && !f.includes('.fingerprints.')).length;
  } catch { /* dir not readable */ }

  return {
    server: {
      uptimeSeconds: process.uptime(),
      nodeVersion: process.version,
      memoryMB: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      },
      cpu: {
        processPercent: serverMetrics.cpuPercent,
        systemPercent: serverMetrics.systemCpuPercent,
        loadAvg: [Math.round(loadAvg[0] * 100) / 100, Math.round(loadAvg[1] * 100) / 100, Math.round(loadAvg[2] * 100) / 100],
        cores: cpuCount,
      },
      network: {
        bandwidthInPerSec: serverMetrics.bandwidthInPerSec,
        bandwidthOutPerSec: serverMetrics.bandwidthOutPerSec,
        port: Number(PORT),
        localIps: getLocalIpv4s(),
        publicIp: getPublicIpCached(),
      },
      ffmpegAvailable,
      ytDlpAvailable,
      ytDlpPath: ytDlpAvailable ? YT_DLP_BIN : null,
    },
    storage: {
      nasMount: { reachable: nas },
      mode: 'local',
      basePath: LOCAL_ASSETS_BASE,
      categories,
    },
    caches: {
      sdr: sdrCache,
      compressed: compressedCache,
      hdr: { count: hdrCache.size },
      svgManifests: getSvgManifestStatus(),
    },
    processes: {
      ytDownloads,
      backgroundTasks: Array.from(backgroundTasks.values()).map(t => {
        const ref = t.runningAt ?? t.queuedAt;
        return {
          id: t.id, type: t.type, label: t.label, status: t.status, detail: t.detail,
          elapsed: t.status === 'queued' ? 0 : Math.round((Date.now() - ref) / 1000),
          queuedAt: t.queuedAt,
          runningAt: t.runningAt,
          meta: t.meta,
        };
      }),
      whisperJobs: whisperJobs.getAll().map(j => ({
        video: j.videoRelPath,
        language: j.language,
        status: j.status,
        phase: j.phase,
        percent: j.percent,
        elapsed: j.startedAt ? Math.round((Date.now() - j.startedAt) / 1000) : 0,
        error: j.error,
      })),
    },
    config: { activeGameshow, gameOrderCount, totalGameFiles },
    nasSync: {
      status: nasSyncStats.status,
      queueLength: nasSyncQueue.length,
      currentOp: nasSyncStats.currentOp,
      throttled: nasSyncStats.throttled,
      bytesSynced: nasSyncStats.bytesSynced,
      startupSync: nasSyncStats.startupSync,
      lastRescanAt: nasSyncStats.lastRescanAt,
    },
  };
}

// GET /api/backend/system-status — aggregated system health dashboard
app.get('/api/backend/system-status', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json(await buildSystemStatusPayload());
  } catch (err) {
    res.status(500).json({ error: `System status failed: ${(err as Error).message}` });
  }
});

// SVG-logo manifests — backs the `github-svg` image-search provider. See
// [server/svg-manifest.ts]. Auto-refresh runs at startup; these routes let the
// admin System tab inspect, force-rebuild, or wipe manifests on demand.
const VALID_SVG_MANIFEST_IDS: SvgManifestId[] = ['gilbarbara', 'detain', 'simple-icons'];
function parseSvgManifestId(value: unknown): SvgManifestId | undefined {
  return typeof value === 'string' && (VALID_SVG_MANIFEST_IDS as string[]).includes(value)
    ? value as SvgManifestId
    : undefined;
}

app.get('/api/backend/system/svg-manifests', (_req, res) => {
  res.json({ manifests: getSvgManifestStatus() });
});

app.post('/api/backend/system/svg-manifests/refresh', async (req, res) => {
  const id = parseSvgManifestId(req.body?.id);
  try {
    if (id) await refreshSvgManifest(id);
    else await refreshAllSvgManifests();
    res.json({ manifests: getSvgManifestStatus() });
  } catch (err) {
    res.status(502).json({ error: `Refresh failed: ${(err as Error).message}` });
  }
});

app.delete('/api/backend/system/svg-manifests', async (req, res) => {
  const id = parseSvgManifestId(req.body?.id);
  try {
    if (id) await deleteSvgManifest(id);
    else await deleteAllSvgManifests();
    res.json({ manifests: getSvgManifestStatus() });
  } catch (err) {
    res.status(500).json({ error: `Delete failed: ${(err as Error).message}` });
  }
});

// GET /api/backend/assets/:category — list files/subfolders
app.get('/api/backend/assets/:category', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const dir = categoryDir(category);

  try {
    if (!existsSync(dir)) {
      return res.json({ files: [] });
    }

    const entries = await readdir(dir, { withFileTypes: true });

    // Hide 'bandle' folder from audio DAM — bandle assets are managed by bandle's own catalog
    const hiddenFolders = category === 'audio' ? ['.', 'backup', 'bandle'] : ['.', 'backup'];
    const withDuration = category !== 'images';
    const withDimensions = category === 'images';
    // For the videos category, also include symlinks (reference-only files) and
    // populate AssetFileMeta.reference. See specs/video-references.md.
    const references = category === 'videos' ? await getReferenceMapCached() : undefined;
    const subfolderOpts: ListFolderOpts = references
      ? { references, relBase: '', probeDimensions: withDimensions }
      : { probeDimensions: withDimensions };
    const subfolders = await Promise.all(
      entries.filter(e => e.isDirectory() && !hiddenFolders.some(h => h === '.' ? e.name.startsWith('.') : e.name === h)).map(e =>
        listFolderRecursive(
          path.join(dir, e.name),
          references
            ? { references, relBase: e.name, probeDimensions: withDimensions }
            : { ...subfolderOpts, relBase: e.name },
        )
      )
    );
    const fileEntries = entries.filter(e => {
      if (e.name.startsWith('.') || e.name.includes('.transcoding.')) return false;
      if (e.isFile()) return true;
      if (references && e.isSymbolicLink()) return true;
      return false;
    });
    // macOS readdir yields NFD for diacritic names; normalize to NFC so DAM
    // paths flow consistently with the NFC-canonical game JSONs. See listFolderRecursive.
    const files = fileEntries.map(e => e.name.normalize('NFC'));
    const fileMeta: Record<string, AssetFileMeta> = {};
    await Promise.all(fileEntries.map(async e => {
      const nfcName = e.name.normalize('NFC');
      if (references) {
        const meta = await videoFileMeta(dir, e.name, references, '');
        if (meta) fileMeta[nfcName] = meta;
        return;
      }
      try {
        const fullPath = path.join(dir, e.name);
        const st = await stat(fullPath);
        const meta: AssetFileMeta = { size: st.size, mtime: st.mtimeMs };
        if (withDuration) {
          const dur = getCachedDuration(fullPath, st.mtimeMs);
          if (dur !== undefined) meta.duration = dur;
        }
        if (withDimensions) {
          const dims = getCachedDimensions(fullPath, st.mtimeMs);
          if (dims !== undefined) meta.dimensions = dims;
        }
        fileMeta[nfcName] = meta;
      } catch { /* skip */ }
    }));
    res.json({ files, fileMeta, subfolders });
    // Probe missing durations in background and push via WebSocket
    if (withDuration) {
      probeDurationsInBackground(category as AssetCategory, dir, files, fileMeta, subfolders);
    }
  } catch (err) {
    res.status(500).json({ error: `Failed to list assets: ${(err as Error).message}` });
  }
});

// GET /api/backend/assets/:category/dimensions — synchronously probe every raster image
// in the category and return the full `path → { width, height }` map. Used by the DAM
// "Niedrige Auflösung" filter and "Auflösung" sort to ensure the client has complete
// data before applying. Concurrency-bounded (8 parallel probes); cached via
// image-dimensions.ts, so subsequent calls are instant.
//
// Only the `images` category is meaningful. Other categories receive an empty map so
// the contract stays uniform and the client can call the endpoint regardless.
app.get('/api/backend/assets/:category/dimensions', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (category !== 'images') {
    return res.json({ dimensions: {} });
  }

  const dir = categoryDir(category);
  if (!existsSync(dir)) {
    return res.json({ dimensions: {} });
  }

  // Phase 1: walk the tree to collect every probeable file path (no I/O on each).
  const tasks: { fullPath: string; relPath: string }[] = [];
  async function walk(currentDir: string, relPrefix: string): Promise<void> {
    let entries;
    try { entries = await readdir(currentDir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'backup') continue;
      const nfcName = entry.name.normalize('NFC');
      if (entry.isDirectory()) {
        await walk(path.join(currentDir, entry.name), relPrefix ? `${relPrefix}/${nfcName}` : nfcName);
      } else if (entry.isFile() && isProbeableImageForDimensions(entry.name)) {
        tasks.push({
          fullPath: path.join(currentDir, entry.name),
          relPath: relPrefix ? `${relPrefix}/${nfcName}` : nfcName,
        });
      }
    }
  }

  try {
    await walk(dir, '');
  } catch (err) {
    return res.status(500).json({ error: `Failed to walk images: ${(err as Error).message}` });
  }

  // Phase 2: probe in parallel with a fixed concurrency. `probeImageDimensions`
  // returns instantly when the file is already in the in-memory cache, so a warm
  // cache makes the whole request essentially free.
  const dimensions: Record<string, { width: number; height: number }> = {};
  const CONCURRENCY = 8;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= tasks.length) return;
        const { fullPath, relPath } = tasks[idx];
        try {
          const st = await stat(fullPath);
          const dims = await probeImageDimensions(fullPath, st.mtimeMs);
          if (dims) dimensions[relPath] = dims;
        } catch { /* skip unreadable */ }
      }
    }),
  );
  saveDimensionCache();
  res.json({ dimensions });
});

// POST /api/backend/assets/:category/upload — upload file
/**
 * Auto-fetch the movie poster for a freshly uploaded video in the background
 * (rate-limited, fire-and-forget). Failures must not affect the upload
 * response, but they are logged — a silently missing poster cost real
 * debugging time before (see IMPROVEMENTS.md §2.1).
 */
function autoFetchPosterInBackground(finalName: string): void {
  const imagesDir = categoryDir('images');
  fetchAndSavePoster(finalName, imagesDir, (msg) => console.log(`[poster-auto] ${msg}`))
    .then(posterRelPath => {
      if (posterRelPath) {
        const slug = videoFilenameToSlug(finalName);
        queueNasCopy('images', `${MOVIE_POSTERS_SUBDIR}/${slug}.jpg`);
        broadcastAssetsChanged('images');
      }
    })
    .catch(err => console.warn(`[poster-auto] ${finalName}: ${(err as Error).message}`));
}

app.post('/api/backend/assets/:category/upload', upload.single('file'), async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const subfolder = (req.query.subfolder as string) || '';
  if (subfolder && !isSafePath(subfolder)) return res.status(400).json({ error: 'Invalid subfolder' });

  const baseDir = subfolder
    ? path.join(categoryDir(category), subfolder)
    : categoryDir(category);

  try {
    await mkdir(baseDir, { recursive: true });
    const destPath = path.join(baseDir, req.file.originalname);
    try {
      await rename(req.file.path, destPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(req.file.path, destPath);
        await unlink(req.file.path);
      } else throw e;
    }
    // Normalize audio files to -16 LUFS during upload
    let finalPath = destPath;
    const isAudio = category === 'audio' || category === 'background-music';
    if (isAudio && isAudioFile(destPath)) {
      const nId = bgTaskStart('audio-normalize', `Normalisierung: ${path.basename(destPath)}`);
      try { finalPath = await normalizeAudioFile(destPath); bgTaskDone(nId); } catch (e) { bgTaskError(nId, (e as Error).message); throw e; }
    }
    const finalName = path.basename(finalPath);
    // Sync to NAS in background
    queueNasCopy(category, subfolder ? `${subfolder}/${finalName}` : finalName);
    _storageStatsCache = null; // file count changed
    if (category === 'videos') {
      invalidateVideoFilesCache();
      autoFetchPosterInBackground(finalName);
    }
    if (category === 'images' && isSupportedImageForColorProfile(finalName)) {
      const relPath = subfolder ? `${subfolder}/${finalName}` : finalName;
      warmColorProfile(categoryDir('images'), relPath);
    }
    if (category === 'images' && isProbeableImageForDimensions(finalName)) {
      const relPath = subfolder ? `${subfolder}/${finalName}` : finalName;
      warmImageDimensions(path.join(categoryDir('images'), relPath));
    }
    broadcastAssetsChanged(category as AssetCategory);
    res.json({ fileName: finalName });
  } catch (err) {
    res.status(500).json({ error: `Failed to upload: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/:category/download-url — download image from URL
app.post('/api/backend/assets/:category/download-url', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const { url: rawUrl, subfolder, desiredName } = req.body as {
    url?: string;
    subfolder?: string;
    desiredName?: string;
  };
  if (!rawUrl || typeof rawUrl !== 'string') return res.status(400).json({ error: 'Missing url' });
  if (subfolder && !isSafePath(subfolder)) return res.status(400).json({ error: 'Invalid subfolder' });

  let validatedDesired: string | undefined;
  if (desiredName !== undefined) {
    if (typeof desiredName !== 'string') return res.status(400).json({ error: 'Invalid desiredName' });
    const trimmed = desiredName.trim();
    // Reject path separators and control chars; spaces and Unicode letters are fine.
     
    if (!trimmed || trimmed.length > 200 || /[\/\\\x00-\x1f]/.test(trimmed)) {
      return res.status(400).json({ error: 'Invalid desiredName' });
    }
    validatedDesired = trimmed;
  }

  try {
    const { buffer, derivedFileName, sniffedExt } = await fetchImageBytesFromUrl(rawUrl);
    const baseDir = subfolder
      ? path.join(categoryDir(category), subfolder)
      : categoryDir(category);
    await mkdir(baseDir, { recursive: true });

    let fileName: string;
    if (validatedDesired) {
      const ext = sniffedExt || path.extname(derivedFileName) || '.jpg';
      fileName = findFreeBasename(baseDir, validatedDesired, ext);
    } else {
      fileName = derivedFileName;
    }

    const destPath = path.join(baseDir, fileName);
    await writeFile(destPath, buffer);

    queueNasCopy(category, subfolder ? `${subfolder}/${fileName}` : fileName);
    _storageStatsCache = null;
    broadcastAssetsChanged(category as AssetCategory);
    res.json({ fileName });
  } catch (err) {
    res.status(500).json({ error: `Download fehlgeschlagen: ${(err as Error).message}` });
  }
});


// ── Chunked upload (for large files with dynamic throttling) ──

const CHUNKS_BASE = path.join(os.tmpdir(), 'gameshow-chunks');

// Cleanup stale chunk directories on startup (older than 1 hour)
(async () => {
  try {
    if (!existsSync(CHUNKS_BASE)) return;
    const dirs = await readdir(CHUNKS_BASE);
    const now = Date.now();
    for (const d of dirs) {
      const p = path.join(CHUNKS_BASE, d);
      try {
        const s = await stat(p);
        if (now - s.mtimeMs > 3600_000) await rm(p, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
})();

// POST /api/backend/assets/:category/upload-chunk — receive a single chunk
app.post('/api/backend/assets/:category/upload-chunk', upload.single('chunk'), async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!req.file) return res.status(400).json({ error: 'No chunk uploaded' });

  const uploadId = req.query.uploadId as string;
  const chunkIndex = req.query.chunkIndex as string;
  if (!uploadId || chunkIndex == null) return res.status(400).json({ error: 'Missing uploadId or chunkIndex' });

  const chunkDir = path.join(CHUNKS_BASE, uploadId);
  try {
    await mkdir(chunkDir, { recursive: true });
    const dest = path.join(chunkDir, chunkIndex);
    try {
      await rename(req.file.path, dest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(req.file.path, dest);
        await unlink(req.file.path);
      } else throw e;
    }
    res.json({ received: true, chunkIndex: Number(chunkIndex) });
  } catch (err) {
    res.status(500).json({ error: `Chunk upload failed: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/:category/upload-finalize — assemble chunks into final file
app.post('/api/backend/assets/:category/upload-finalize', express.json(), async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const { uploadId, fileName, totalChunks, subfolder } = req.body as {
    uploadId: string; fileName: string; totalChunks: number; subfolder?: string;
  };
  if (!uploadId || !fileName || !totalChunks) return res.status(400).json({ error: 'Missing fields' });
  if (subfolder && !isSafePath(subfolder)) return res.status(400).json({ error: 'Invalid subfolder' });

  const chunkDir = path.join(CHUNKS_BASE, uploadId);
  if (!existsSync(chunkDir)) return res.status(400).json({ error: 'No chunks found for this upload' });

  const baseDir = subfolder ? path.join(categoryDir(category), subfolder) : categoryDir(category);

  try {
    // Verify all chunks are present
    for (let i = 0; i < totalChunks; i++) {
      if (!existsSync(path.join(chunkDir, String(i)))) {
        return res.status(400).json({ error: `Missing chunk ${i}` });
      }
    }

    await mkdir(baseDir, { recursive: true });
    const destPath = path.join(baseDir, fileName);

    // Stream-concatenate chunks to avoid loading entire file into memory
    const { createReadStream: crs } = await import('fs');
    const ws = createWriteStream(destPath);
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(chunkDir, String(i));
      await new Promise<void>((resolve, reject) => {
        const rs = crs(chunkPath);
        rs.pipe(ws, { end: false });
        rs.on('end', resolve);
        rs.on('error', reject);
      });
    }
    ws.end();
    await new Promise<void>((resolve, reject) => {
      ws.on('finish', resolve);
      ws.on('error', reject);
    });

    // Cleanup chunks
    await rm(chunkDir, { recursive: true, force: true });

    // Same post-processing as regular upload
    let finalPath = destPath;
    const isAudio = category === 'audio' || category === 'background-music';
    if (isAudio && isAudioFile(destPath)) {
      const nId = bgTaskStart('audio-normalize', `Normalisierung: ${path.basename(destPath)}`);
      try { finalPath = await normalizeAudioFile(destPath); bgTaskDone(nId); } catch (e) { bgTaskError(nId, (e as Error).message); throw e; }
    }
    const finalName = path.basename(finalPath);

    queueNasCopy(category, subfolder ? `${subfolder}/${finalName}` : finalName);
    _storageStatsCache = null; // file count changed
    if (category === 'videos') {
      invalidateVideoFilesCache();
      autoFetchPosterInBackground(finalName);
    }
    if (category === 'images' && isSupportedImageForColorProfile(finalName)) {
      const relPath = subfolder ? `${subfolder}/${finalName}` : finalName;
      warmColorProfile(categoryDir('images'), relPath);
    }
    if (category === 'images' && isProbeableImageForDimensions(finalName)) {
      const relPath = subfolder ? `${subfolder}/${finalName}` : finalName;
      warmImageDimensions(path.join(categoryDir('images'), relPath));
    }
    broadcastAssetsChanged(category as AssetCategory);

    res.json({ fileName: finalName });
  } catch (err) {
    res.status(500).json({ error: `Finalize failed: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/:category/upload-abort — cleanup partial chunks
app.post('/api/backend/assets/:category/upload-abort', express.json(), async (req, res) => {
  const { uploadId } = req.body as { uploadId: string };
  if (!uploadId) return res.status(400).json({ error: 'Missing uploadId' });
  const chunkDir = path.join(CHUNKS_BASE, uploadId);
  try {
    if (existsSync(chunkDir)) await rm(chunkDir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Abort cleanup failed: ${(err as Error).message}` });
  }
});

// ── yt-dlp binary management (auto-downloaded standalone binary) ──
// Binary bootstrap lives in ./yt-dlp.ts so the download flow (below) and the
// keyword-search flow (./youtube-search.ts) share one implementation.
import { YT_DLP_BIN, YT_DLP_JS_RUNTIME_ARGS, ensureYtDlp } from './yt-dlp.js';

function isPlaylistUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.searchParams.has('list') || u.pathname === '/playlist';
  } catch {
    return false;
  }
}

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

/**
 * Promote legacy YouTube-thumbnail covers into the canonical `Audio-Covers/` root.
 * Before the audio-cover-override feature, `saveYtThumbnailAsCover` wrote into a
 * `YouTube Thumbnails/` subfolder that the DAM's AudioCover component never
 * looked at — so those covers were effectively invisible. Copy every such file
 * that doesn't yet have a canonical sibling, and record a `source: 'youtube'`
 * meta entry so the DAM pill reflects the origin. Idempotent.
 */
async function backfillYoutubeAudioCovers(): Promise<void> {
  const imagesDir = categoryDir('images');
  const ytDir = path.join(imagesDir, AUDIO_COVERS_SUBDIR, 'YouTube Thumbnails');
  const coverDir = path.join(imagesDir, AUDIO_COVERS_SUBDIR);
  if (!existsSync(ytDir)) return;
  let entries: string[];
  try { entries = await readdir(ytDir); }
  catch { return; }
  for (const name of entries) {
    if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;
    const src = path.join(ytDir, name);
    const dest = path.join(coverDir, name);
    if (existsSync(dest)) continue;
    try {
      const st = await stat(src);
      if (!st.isFile()) continue;
      await copyFile(src, dest);
      await setAudioCoverMeta(imagesDir, name, { source: 'youtube', setAt: st.mtimeMs });
    } catch (err) {
      console.warn(`[audio-covers] Failed to promote ${name}: ${(err as Error).message}`);
    }
  }
}

/**
 * Fuzzy title normalization for duplicate-detection: lowercase + strip every char that
 * isn't a letter or digit. Lets us match across yt-dlp's title-sanitization variations
 * (punctuation, whitespace, hyphens vs spaces, track-number prefixes, etc.) without
 * trying to replicate yt-dlp's exact rules. Returns '' for titles that are too short
 * to be useful — callers should treat those as "no match" to avoid spurious skips.
 */
function normalizeTitleForMatch(s: string): string {
  const norm = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return norm.length >= 4 ? norm : '';
}

/**
 * Look for an existing file in `dir` whose normalized basename contains the normalized
 * `title`. Returns the matching filename or null. Used to skip YouTube downloads whose
 * output would collide with a file already on disk.
 */
function findExistingTitleMatch(dir: string, title: string): string | null {
  const normTitle = normalizeTitleForMatch(title);
  if (!normTitle) return null;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return null; }
  for (const f of entries) {
    if (f.startsWith('.')) continue;
    const base = f.replace(/\.[^.]+$/, '');
    const normBase = normalizeTitleForMatch(base);
    if (normBase && normBase.includes(normTitle)) return f;
  }
  return null;
}

/**
 * Compute MD5 hash of a file for content-based deduplication.
 */
async function fileHash(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * If yt-dlp wrote a thumbnail alongside the downloaded media (via `--write-thumbnail`
 * `--convert-thumbnails jpg`), copy it into the audio-cover or movie-poster slot so
 * we get a deterministic, correctly-attributed cover without a separate web lookup.
 * Respects the asset alias map — merged-away covers are not resurrected, and existing
 * covers are never overwritten.
 *
 * Content-dedup: if an identical image (by hash) already exists in the target directory,
 * the copy is skipped — this prevents playlist downloads from creating dozens of
 * duplicate thumbnails when every track shares the same YouTube thumbnail.
 *
 * @returns the saved filename (relative to the subdir) or null if nothing was saved
 */
async function saveYtThumbnailAsCover(
  sourceDir: string,
  mediaFileName: string,
  imagesDir: string,
  kind: 'audio' | 'video',
): Promise<string | null> {
  try {
    const jpgs = (await readdir(sourceDir)).filter(f => f.toLowerCase().endsWith('.jpg'));
    if (jpgs.length === 0) return null;
    const thumbPath = path.join(sourceDir, jpgs[0]);

    const subdir = kind === 'audio' ? AUDIO_COVERS_SUBDIR : MOVIE_POSTERS_SUBDIR;
    // Audio covers live at the canonical root so the DAM's AudioCover component
    // (which only looks at `/images/Audio-Covers/{basename}.jpg`) finds them.
    // Video posters keep the legacy 'YouTube Thumbnails/' subfolder layout.
    const targetDir = kind === 'audio'
      ? path.join(imagesDir, subdir)
      : path.join(imagesDir, subdir, 'YouTube Thumbnails');
    await mkdir(targetDir, { recursive: true });
    const derivedName = kind === 'audio'
      ? audioCoverFilename(mediaFileName)
      : `${videoFilenameToSlug(mediaFileName)}.jpg`;
    const resolvedName = await resolveAliasChecked(imagesDir, targetDir, derivedName);
    const destPath = path.join(targetDir, resolvedName);
    if (existsSync(destPath)) return null;

    // Content-based dedup: hash the incoming thumbnail and compare against every
    // existing image in the target dir. If an identical file is already there,
    // skip the copy — this avoids playlist thumbnails duplicating across tracks.
    const thumbHash = await fileHash(thumbPath);
    const existing = await readdir(targetDir);
    for (const f of existing) {
      if (f.startsWith('.') || !/\.(jpe?g|png|webp)$/i.test(f)) continue;
      const existingHash = await fileHash(path.join(targetDir, f));
      if (existingHash === thumbHash) {
        // Identical content already on disk — skip
        return null;
      }
    }

    await copyFile(thumbPath, destPath);
    if (kind === 'audio') {
      await setAudioCoverMeta(imagesDir, resolvedName, { source: 'youtube', setAt: Date.now() });
      return resolvedName;
    }
    return `YouTube Thumbnails/${resolvedName}`;
  } catch (e) {
    console.warn(`[yt-thumb] Failed to save thumbnail as ${kind} cover: ${(e as Error).message}`);
    return null;
  }
}

// ── YouTube download job tracking (survives page reload) ──
interface YtDownloadJobTrack {
  title: string;
  phase: 'resolving' | 'downloading' | 'processing' | 'done';
  percent: number;
}
interface YtDownloadJob {
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
  tracks?: YtDownloadJobTrack[];
}
const ytDownloadJobs = new Map<string, YtDownloadJob>();
// Abort controllers for cancellable downloads — keyed by jobId
const ytDownloadAbortControllers = new Map<string, AbortController>();

// POST /api/backend/yt-download-cancel/:jobId — cancel an active YouTube download
app.post('/api/backend/yt-download-cancel/:jobId', (_req, res) => {
  const { jobId } = _req.params;
  const ac = ytDownloadAbortControllers.get(jobId);
  if (!ac) return res.status(404).json({ error: 'Job not found or already finished' });
  ac.abort();
  res.json({ ok: true });
});

// POST /api/backend/assets/:category/youtube-download — download audio/video from YouTube via yt-dlp
app.post('/api/backend/assets/:category/youtube-download', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const ytAllowed = ['audio', 'background-music', 'videos'];
  if (!ytAllowed.includes(category)) {
    return res.status(400).json({ error: 'YouTube download only supported for audio and video categories' });
  }
  const isVideoDownload = category === 'videos';
  const { url, subfolder, playlist } = req.body as { url?: string; subfolder?: string; playlist?: boolean };
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });
  if (subfolder && !isSafePath(subfolder)) return res.status(400).json({ error: 'Invalid subfolder' });

  // ── Job tracking ──
  const jobId = `yt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const jobAbort = new AbortController();
  const job: YtDownloadJob = {
    id: jobId, category, phase: 'downloading', percent: 0, title: '', startedAt: Date.now(),
  };
  ytDownloadJobs.set(jobId, job);
  ytDownloadAbortControllers.set(jobId, jobAbort);
  broadcast('yt-download-status', { jobs: Array.from(ytDownloadJobs.values()) });

  // SSE setup — disable all buffering so progress reaches the client immediately
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data: Record<string, unknown>) => {
    // Update in-memory job for reconnection after page reload
    // Per-track events (trackIndex > 0) must not override the job-level phase,
    // because concurrent workers send interleaved events (e.g. per-track 'done'
    // would prematurely mark the whole job as done).
    const isPerTrackEvent = (data.trackIndex as number) > 0;
    if (data.phase && !isPerTrackEvent) job.phase = data.phase as YtDownloadJob['phase'];
    if (data.percent != null) job.percent = data.percent as number;
    if (data.title != null) job.title = data.title as string;
    if (data.fileName) job.fileName = data.fileName as string;
    if (data.message && data.phase === 'error') job.error = data.message as string;
    if (data.playlistTitle != null) job.playlistTitle = data.playlistTitle as string;
    if (data.trackIndex != null) job.trackIndex = data.trackIndex as number;
    if (data.trackCount != null) job.trackCount = data.trackCount as number;
    // Per-track state for playlists — each track is independent (no "mark previous as done" heuristic)
    // because resolve and download workers run concurrently and events arrive out of order.
    if (data.trackIndex != null && (data.trackIndex as number) > 0) {
      if (!job.tracks) job.tracks = [];
      const idx = (data.trackIndex as number) - 1;
      while (job.tracks.length <= idx) {
        job.tracks.push({ title: '', phase: 'resolving', percent: 0 });
      }
      const phase = data.phase as string;
      const title = (data.title as string) || job.tracks[idx].title;
      if (phase === 'resolving') {
        job.tracks[idx] = { title, phase: 'resolving', percent: 0 };
      } else if (phase === 'downloading') {
        job.tracks[idx] = { title, phase: 'downloading', percent: (data.percent as number) ?? job.tracks[idx].percent };
      } else if (phase === 'processing') {
        job.tracks[idx] = { title, phase: 'processing', percent: 100 };
      } else if (phase === 'done') {
        job.tracks[idx] = { title, phase: 'done', percent: 100 };
      }
    }

    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush();
    }
    broadcastThrottled('yt-download-status', { jobs: Array.from(ytDownloadJobs.values()) }, 1000);
  };

  // Emit jobId so the client can track this download across reloads
  send({ jobId });

  // Auto-cleanup: remove finished jobs from Map after 60s (same as transcode jobs)
  res.on('finish', () => {
    ytDownloadAbortControllers.delete(jobId);
    broadcast('yt-download-status', { jobs: Array.from(ytDownloadJobs.values()) });
    setTimeout(() => {
      const j = ytDownloadJobs.get(jobId);
      if (j && (j.phase === 'done' || j.phase === 'error')) {
        ytDownloadJobs.delete(jobId);
        broadcast('yt-download-status', { jobs: Array.from(ytDownloadJobs.values()) });
      }
    }, 60_000);
  });

  // Ensure yt-dlp binary is available (auto-downloads on first use)
  try {
    await ensureYtDlp();
  } catch (err) {
    send({ phase: 'error', message: `yt-dlp konnte nicht heruntergeladen werden: ${(err as Error).message}` });
    res.end();
    return;
  }

  const tmpDir = path.join(os.tmpdir(), `yt-dl-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  // ── Playlist download (audio categories only, when explicitly requested) ──
  if (playlist && isPlaylistUrl(url) && !isVideoDownload) {

    // Quick metadata: --flat-playlist only reads the playlist page, not each video
    send({ phase: 'resolving', percent: 0, playlistTitle: '', trackIndex: 0, trackCount: 0 });

    let playlistTitle = 'Playlist';
    interface TrackInfo { id: string; title: string }
    const tracks: TrackInfo[] = [];
    try {
      // --flat-playlist avoids fetching each video page — just reads the playlist index.
      // Use spawn (async) instead of execFileSync to keep the event loop free so that a
      // cancel request arriving during metadata fetch can be processed immediately.
      const metaLines = await new Promise<string[]>((resolve, reject) => {
        const proc = spawn(YT_DLP_BIN, [
          ...YT_DLP_JS_RUNTIME_ARGS,
          '--flat-playlist', '--print', '%(playlist_title)s\t%(id)s\t%(title)s', url,
        ]);

        // Respect cancel: kill the metadata process if the job is aborted
        const onAbort = () => { proc.kill('SIGTERM'); };
        jobAbort.signal.addEventListener('abort', onAbort, { once: true });

        let out = '';
        proc.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
        proc.stderr.on('data', () => {}); // discard stderr

        const metaTimeout = setTimeout(() => { proc.kill('SIGTERM'); }, 30_000);

        proc.on('close', (code) => {
          clearTimeout(metaTimeout);
          jobAbort.signal.removeEventListener('abort', onAbort);
          if (jobAbort.signal.aborted) { resolve([]); return; }
          if (code === 0) resolve(out.trim().split('\n'));
          else reject(new Error(`yt-dlp metadata exit ${code}`));
        });
      });

      for (const line of metaLines) {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          if (!playlistTitle || playlistTitle === 'Playlist') playlistTitle = parts[0];
          tracks.push({ id: parts[1], title: parts[2] });
        }
      }
    } catch { /* tracks stays empty */ }

    // Check abort after the (now async) metadata fetch
    if (jobAbort.signal.aborted) {
      send({ phase: 'error', message: 'Download abgebrochen' });
      res.end();
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return;
    }

    if (tracks.length === 0) {
      send({ phase: 'error', message: 'Playlist ist leer oder konnte nicht geladen werden' });
      res.end();
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return;
    }

    const trackCount = tracks.length;
    send({ phase: 'downloading', percent: 0, playlistTitle, trackIndex: 0, trackCount });

    // Determine target subfolder
    const playlistFolder = sanitizeFolderName(playlistTitle);
    const targetSubfolder = subfolder ? `${subfolder}/${playlistFolder}` : playlistFolder;
    const baseDir = path.join(categoryDir(category), targetSubfolder);
    await mkdir(baseDir, { recursive: true });

    // Skip tracks whose title fuzzy-matches a file already in baseDir — lets the user
    // re-run the same playlist download without re-paying the YouTube round-trip or
    // overwriting edits. Matched tracks are reported as 'done' up-front so the client
    // sees them completed without ever entering a worker.
    const skippedIndices = new Set<number>();
    for (const [idx, t] of tracks.entries()) {
      const matched = findExistingTitleMatch(baseDir, t.title);
      if (matched) {
        skippedIndices.add(idx);
        send({ phase: 'done', title: t.title, trackIndex: idx + 1, trackCount, playlistTitle });
      }
    }
    const pendingTrackIndices = tracks.map((_, i) => i).filter(i => !skippedIndices.has(i));

    try {
      // Download tracks in parallel with concurrency limit.
      // Each worker runs a single yt-dlp process per track (resolve + download in one call).
      // The track starts in 'resolving' phase (while yt-dlp extracts metadata / stream URLs)
      // and transitions to 'downloading' once progress percentages appear.
      const DL_CONCURRENCY = 4;
      const finalPaths: string[] = [];

      // Worker function: download + convert a single track
      const downloadTrack = async (track: TrackInfo, index: number): Promise<string | null> => {
        if (jobAbort.signal.aborted) return null;
        const trackDir = path.join(tmpDir, `track-${index}`);
        await mkdir(trackDir, { recursive: true });

        const paddedIdx = String(index + 1).padStart(String(trackCount).length, '0');

        // Start in 'resolving' phase — yt-dlp will first fetch the video page / extract streams
        send({ phase: 'resolving', percent: 0, title: track.title, trackIndex: index + 1, trackCount, playlistTitle });

        const ytdlpArgs = [
          ...YT_DLP_JS_RUNTIME_ARGS,
          '-f', 'bestaudio',
          '-x', '--audio-format', 'mp3', '--audio-quality', '0',
          '--no-playlist',
          '--newline',
          '--write-thumbnail',
          '--convert-thumbnails', 'jpg',
          '--ffmpeg-location', FFMPEG_BIN,
          '-o', path.join(trackDir, `${paddedIdx} - %(title)s.%(ext)s`),
          `https://www.youtube.com/watch?v=${track.id}`,
        ];
        const ytdlp = spawn(YT_DLP_BIN, ytdlpArgs);

        // Kill child process if job is cancelled
        const onAbort = () => { ytdlp.kill('SIGTERM'); };
        jobAbort.signal.addEventListener('abort', onAbort, { once: true });

        let lastPct = -1;
        let buf = '';
        let resolvedToDownloading = false;

        const onData = (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop()!;
          for (const line of lines) {
            const pctMatch = line.match(/(\d+(?:\.\d+)?)%/);
            if (pctMatch) {
              const pct = Math.round(parseFloat(pctMatch[1]));
              if (!resolvedToDownloading) {
                resolvedToDownloading = true;
              }
              if (pct !== lastPct) {
                lastPct = pct;
                send({ phase: 'downloading', percent: pct, title: track.title, trackIndex: index + 1, trackCount, playlistTitle });
              }
            }
          }
        };

        ytdlp.stderr.on('data', onData);
        ytdlp.stdout.on('data', onData);

        const exitCode = await new Promise<number>((resolve) => {
          ytdlp.on('close', resolve);
        });

        jobAbort.signal.removeEventListener('abort', onAbort);

        if (jobAbort.signal.aborted || exitCode !== 0) return null;

        const files = (await readdir(trackDir)).filter(f => !f.startsWith('.'));
        // yt-dlp writes the media file + a .jpg thumbnail (via --write-thumbnail). Pick the
        // non-jpg as the media file; the jpg is saved as the audio cover below.
        const mediaFiles = files.filter(f => !f.toLowerCase().endsWith('.jpg'));
        if (mediaFiles.length === 0) return null;

        const dlFile = mediaFiles[0];
        const destPath = path.join(baseDir, dlFile);
        const dlPath = path.join(trackDir, dlFile);
        try {
          await rename(dlPath, destPath);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
            await copyFile(dlPath, destPath);
            await unlink(dlPath);
          } else throw e;
        }

        // Normalize audio
        send({ phase: 'processing', title: track.title, trackIndex: index + 1, trackCount, playlistTitle });
        let finalPath = destPath;
        if (isAudioFile(destPath)) {
          const nId = bgTaskStart('audio-normalize', `Normalisierung: ${path.basename(destPath)}`);
          try { finalPath = await normalizeAudioFile(destPath); bgTaskDone(nId); } catch (e) { bgTaskError(nId, (e as Error).message); throw e; }
        }

        // Sync to NAS in background
        const finalName = path.basename(finalPath);
        queueNasCopy(category, `${targetSubfolder}/${finalName}`);

        // Save YouTube thumbnail as audio cover (best-effort, non-fatal)
        const imagesDir = categoryDir('images');
        const savedCover = await saveYtThumbnailAsCover(trackDir, finalName, imagesDir, 'audio');
        if (savedCover) {
          queueNasCopy('images', `${AUDIO_COVERS_SUBDIR}/${savedCover}`);
          broadcastAssetsChanged('images');
        }

        // Notify DAM clients per-track so the playlist folder fills in live
        broadcastAssetsChanged(category as AssetCategory);

        // Mark this track as done explicitly
        send({ phase: 'done', title: track.title, trackIndex: index + 1, trackCount, playlistTitle });

        return finalPath;
      };

      // Run workers with concurrency limit — only on tracks not already on disk
      let nextCursor = 0;
      const runWorker = async () => {
        while (nextCursor < pendingTrackIndices.length && !jobAbort.signal.aborted) {
          const idx = pendingTrackIndices[nextCursor++];
          const result = await downloadTrack(tracks[idx], idx);
          if (result) finalPaths.push(result);
        }
      };
      await Promise.all(Array.from({ length: Math.min(DL_CONCURRENCY, pendingTrackIndices.length) }, () => runWorker()));

      if (jobAbort.signal.aborted) {
        send({ phase: 'error', message: 'Download abgebrochen' });
        res.end();
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        return;
      }

      // All tracks already on disk → still a success (nothing to download).
      if (finalPaths.length === 0 && pendingTrackIndices.length > 0) {
        send({ phase: 'error', message: 'Keine Dateien konnten heruntergeladen werden' });
        res.end();
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        return;
      }

      send({ phase: 'done', playlistTitle, trackCount: finalPaths.length + skippedIndices.size, fileName: playlistFolder });
      res.end();
    } catch (err) {
      send({ phase: 'error', message: `Fehler: ${(err as Error).message}` });
      res.end();
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }

  // ── Single video download ──
  let title = '';
  send({ phase: 'resolving', percent: 0, title });

  // Probe the YouTube title up-front so we can skip when a file for this track is
  // already on disk. Fuzzy-match against the target folder — cheap metadata call, and
  // avoids a redundant full download when the user pastes the same URL twice.
  const singleBaseDir = subfolder ? path.join(categoryDir(category), subfolder) : categoryDir(category);
  try {
    const probedTitle = await new Promise<string>((resolve) => {
      const proc = spawn(YT_DLP_BIN, [...YT_DLP_JS_RUNTIME_ARGS, '--skip-download', '--no-playlist', '--print', '%(title)s', url]);
      const onAbort = () => { proc.kill('SIGTERM'); };
      jobAbort.signal.addEventListener('abort', onAbort, { once: true });
      let out = '';
      proc.stdout.on('data', (c: Buffer) => { out += c.toString(); });
      proc.stderr.on('data', () => {});
      const t = setTimeout(() => proc.kill('SIGTERM'), 15_000);
      proc.on('close', () => {
        clearTimeout(t);
        jobAbort.signal.removeEventListener('abort', onAbort);
        resolve(out.trim().split('\n')[0] ?? '');
      });
    });
    if (probedTitle) {
      title = probedTitle;
      send({ phase: 'resolving', percent: 0, title });
      const existing = findExistingTitleMatch(singleBaseDir, probedTitle);
      if (existing) {
        send({ phase: 'done', fileName: existing, title: probedTitle });
        res.end();
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        return;
      }
    }
  } catch { /* probe failed — continue with full download */ }

  if (jobAbort.signal.aborted) {
    send({ phase: 'error', message: 'Download abgebrochen' });
    res.end();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    return;
  }

  try {
    // Step 1: Download with yt-dlp (audio extraction or video depending on category)
    const ytdlpArgs = isVideoDownload
      ? [
          ...YT_DLP_JS_RUNTIME_ARGS,
          // Codec preference for the raw DAM <video> preview: H.264 → VP9 → anything
          // but AV1 → (AV1 only as an absolute last resort). Browsers can't decode
          // AV1 via a plain <video> (YouTube serves AV1 only to clients that
          // advertise support, and silently sends others VP9/H.264 — so an AV1
          // download shows "broken" even though YouTube itself plays). H.264 and VP9
          // both play in every browser; VP9 must be listed explicitly because it
          // lives in webm, so a bare `best[ext=mp4]` would skip it and grab AV1.
          // No forced `--merge-output-format`: H.264 pairs with m4a → mp4, VP9 pairs
          // with webm audio → webm, each in its native container.
          '-f', 'bv*[vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[vcodec^=avc1][ext=mp4]/bv*[vcodec^=vp9]+ba[ext=webm]/bv*[vcodec^=vp9]+ba/bv*[vcodec!^=av01]+ba/b[vcodec!^=av01]/b',
          '--no-playlist',
          '--newline',
          '--write-thumbnail',
          '--convert-thumbnails', 'jpg',
          '--ffmpeg-location', FFMPEG_BIN,
          '-o', path.join(tmpDir, '%(title)s.%(ext)s'),
          url,
        ]
      : [
          ...YT_DLP_JS_RUNTIME_ARGS,
          '-f', 'bestaudio',             // download audio stream only (skip video)
          '-x',                          // extract audio
          '--audio-format', 'mp3',       // convert to mp3
          '--audio-quality', '0',        // best quality
          '--no-playlist',               // single video only
          '--newline',                   // progress on new lines (one line per update)
          '--write-thumbnail',           // YT thumbnail → audio cover
          '--convert-thumbnails', 'jpg',
          '--ffmpeg-location', FFMPEG_BIN,
          '-o', path.join(tmpDir, '%(title)s.%(ext)s'),
          url,
        ];
    const ytdlp = spawn(YT_DLP_BIN, ytdlpArgs);

    let downloadError = '';
    let lastPct = -1;
    // For video downloads, yt-dlp downloads two streams (video then audio).
    // Track which stream we're on to compute combined progress.
    let streamIndex = 0; // 0 = first stream (video), 1 = second stream (audio)
    let buf = '';

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      downloadError += text;
      buf += text;
      const lines = buf.split('\n');
      buf = lines.pop()!;
      for (const line of lines) {
        // Detect new stream starting (second [download] Destination line)
        const destMatch = line.match(/\[download\] Destination: (.+)/);
        if (destMatch) {
          const name = path.basename(destMatch[1]).replace(/\.[^.]+$/, '');
          // Use the first destination as the title (cleanest name)
          if (!title) {
            // Strip format suffix like ".f137" or ".f140" that yt-dlp adds for split streams
            title = name.replace(/\.f\d+$/, '');
            send({ phase: 'downloading', percent: 0, title });
          } else if (isVideoDownload) {
            // Second stream starting — advance stream index
            streamIndex = 1;
          }
          continue;
        }
        // Detect ffmpeg merge phase (video downloads with separate streams)
        if (isVideoDownload && line.includes('[Merger]')) {
          send({ phase: 'processing', title });
          continue;
        }
        // Extract percentage — yt-dlp outputs lines like "[download]  45.2% of 5.23MiB ..."
        const pctMatch = line.match(/(\d+(?:\.\d+)?)%/);
        if (pctMatch) {
          let pct = Math.round(parseFloat(pctMatch[1]));
          // For two-stream video downloads, map to combined progress:
          // stream 0 (video): 0-90%, stream 1 (audio): 90-100%
          if (isVideoDownload && streamIndex === 0) {
            pct = Math.round(pct * 0.9);
          } else if (isVideoDownload && streamIndex === 1) {
            pct = Math.round(90 + pct * 0.1);
          }
          if (pct !== lastPct) {
            lastPct = pct;
            send({ phase: 'downloading', percent: pct, title });
          }
        }
      }
    };

    // yt-dlp prints progress on stderr with --newline
    ytdlp.stderr.on('data', onData);
    ytdlp.stdout.on('data', onData);

    const exitCode = await new Promise<number>((resolve) => {
      ytdlp.on('close', resolve);
    });

    if (exitCode !== 0) {
      send({ phase: 'error', message: `yt-dlp fehlgeschlagen (Exit Code ${exitCode}): ${downloadError.slice(0, 300)}` });
      res.end();
      await rm(tmpDir, { recursive: true, force: true });
      return;
    }

    // Find the downloaded file. yt-dlp with --write-thumbnail also writes a .jpg alongside;
    // we separate the media (non-jpg) from the thumbnail so the latter is picked up below.
    const downloaded = await readdir(tmpDir);
    const mediaFiles = downloaded.filter(f => !f.toLowerCase().endsWith('.jpg'));
    if (mediaFiles.length === 0) {
      send({ phase: 'error', message: 'Keine Datei heruntergeladen' });
      res.end();
      await rm(tmpDir, { recursive: true, force: true });
      return;
    }

    const dlFile = mediaFiles[0];
    const dlPath = path.join(tmpDir, dlFile);

    // Step 2: Move to asset directory (audio is normalized below; video is not)
    send({ phase: 'processing' });
    await mkdir(singleBaseDir, { recursive: true });

    const destPath = path.join(singleBaseDir, dlFile);
    try {
      await rename(dlPath, destPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(dlPath, destPath);
        await unlink(dlPath);
      } else throw e;
    }

    // Normalize audio (skip for video downloads). A failure here is non-fatal —
    // the download still succeeds with the un-normalized file, and the user
    // gets a "done" instead of an error so the progress modal can close.
    let finalPath = destPath;
    if (!isVideoDownload && isAudioFile(destPath)) {
      const nId = bgTaskStart('audio-normalize', `Normalisierung: ${path.basename(destPath)}`);
      try { finalPath = await normalizeAudioFile(destPath); bgTaskDone(nId); }
      catch (e) { bgTaskError(nId, (e as Error).message); }
    }
    const finalName = path.basename(finalPath);

    _storageStatsCache = null;
    broadcastAssetsChanged(category as AssetCategory);
    send({ phase: 'done', fileName: finalName });
    res.end();

    // Post-processing: fire-and-forget so a slow/failing thumbnail copy or NAS
    // enqueue can never hold the SSE open (which is how the "stuck at
    // normalizing" modal bug was happening). Owns tmpDir cleanup.
    (async () => {
      try {
        queueNasCopy(category, subfolder ? `${subfolder}/${finalName}` : finalName);
        const imagesDir = categoryDir('images');
        const savedThumb = await saveYtThumbnailAsCover(
          tmpDir,
          finalName,
          imagesDir,
          isVideoDownload ? 'video' : 'audio',
        );
        if (savedThumb) {
          const subdir = isVideoDownload ? MOVIE_POSTERS_SUBDIR : AUDIO_COVERS_SUBDIR;
          queueNasCopy('images', `${subdir}/${savedThumb}`);
          broadcastAssetsChanged('images');
        }
        if (isVideoDownload) {
          invalidateVideoFilesCache();
          // Make the file instantly seekable: yt-dlp's merged mp4 usually has its
          // moov atom at the end, so a raw <video> stalls until the whole file
          // downloads (the "plays only after reload" symptom). Remux moov to the
          // front in the background (stream-copy, cheap) unless it's already
          // faststart. Decoupled + idempotent — the DAM preview picks up the
          // running remux via faststart-status if the user opens the file meanwhile.
          // Faststart only applies to mp4 (moov atom) — skip webm/VP9 downloads,
          // which are seekable via cues and would be corrupted by the mp4 remux.
          if (finalName.toLowerCase().endsWith('.mp4')) {
            try {
              const relPath = subfolder ? `${subfolder}/${finalName}` : finalName;
              const { videoInfo } = await cachedProbe(finalPath, relPath);
              if (!videoInfo?.faststart) runFaststartRemux(finalPath, relPath);
            } catch { /* faststart is best-effort */ }
          }
          if (!savedThumb) {
            try {
              const posterRelPath = await fetchAndSavePoster(finalName, imagesDir, (msg) => console.log(`[poster-auto] ${msg}`));
              if (posterRelPath) {
                const slug = videoFilenameToSlug(finalName);
                queueNasCopy('images', `${MOVIE_POSTERS_SUBDIR}/${slug}.jpg`);
                broadcastAssetsChanged('images');
              }
            } catch { /* poster fallback is best-effort */ }
          }
        }
      } catch (e) {
        console.warn(`[yt-dl] post-processing failed: ${(e as Error).message}`);
      } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    })();
  } catch (err) {
    send({ phase: 'error', message: `Fehler: ${(err as Error).message}` });
    res.end();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

// POST /api/backend/assets/videos/fetch-cover — fetch movie poster on demand
app.post('/api/backend/assets/videos/fetch-cover', async (req, res) => {
  const { fileName } = req.body as { fileName?: string };
  if (!fileName || !isSafePath(fileName)) return res.status(400).json({ error: 'Invalid fileName' });

  const imagesDir = categoryDir('images');
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log(`[poster] ${msg}`); };
  const posterId = bgTaskStart('poster-fetch', `Poster: ${fileName}`);

  try {
    const posterRelPath = await fetchAndSavePoster(fileName, imagesDir, log);
    if (posterRelPath) {
      const slug = videoFilenameToSlug(fileName);
      queueNasCopy('images', `${MOVIE_POSTERS_SUBDIR}/${slug}.jpg`);
      broadcastAssetsChanged('images');
    }
    bgTaskDone(posterId);
    res.json({ posterPath: posterRelPath, logs });
  } catch (err) {
    bgTaskError(posterId, (err as Error).message);
    res.status(500).json({ error: `Failed to fetch cover: ${(err as Error).message}`, logs });
  }
});

// GET /api/backend/assets/videos/probe?path=... — check audio tracks
app.get('/api/backend/assets/videos/probe', async (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath || !isSafePath(filePath)) return res.status(400).json({ error: 'Invalid path' });
  const fullPath = path.join(categoryDir('videos'), filePath);
  if (!existsSync(fullPath)) {
    // Source unreachable (dangling symlink for an offline reference, or a deleted file).
    // Return the last probed result if we have one so the client keeps stable track/HDR
    // info — otherwise cache keys flip and previously-ready caches look "missing" in the UI.
    const cached = probeResultCache.get(filePath);
    if (cached) return res.json({ ...cached.result, sourceOnline: false });
    return res.status(404).json({ error: 'File not found' });
  }
  try {
    const result = await cachedProbe(fullPath, filePath);
    res.json({ ...result, sourceOnline: true });
  } catch (err) {
    res.status(500).json({ error: `Probe failed: ${(err as Error).message}` });
  }
});

// ── Reference-only videos (see specs/video-references.md) ──

// GET /api/backend/assets/videos/reference-roots — allowed roots and current reachability
app.get('/api/backend/assets/videos/reference-roots', (_req, res) => {
  const roots = getReferenceRoots().map(p => {
    let reachable = false;
    try { reachable = statSync(p).isDirectory(); } catch { /* unreachable */ }
    const label = labelForRoot(p);
    return label ? { path: p, reachable, label } : { path: p, reachable };
  });
  res.json({ roots });
});

// GET /api/backend/assets/videos/reference-browse?path=<abs> — list dirs + video files
app.get('/api/backend/assets/videos/reference-browse', async (req, res) => {
  const raw = typeof req.query.path === 'string' ? req.query.path : '';
  if (!raw) return res.status(400).json({ error: 'path query parameter required' });
  const abs = path.resolve(raw);
  if (!isPathWithinReferenceRoots(abs)) {
    return res.status(403).json({ error: 'Pfad liegt außerhalb der erlaubten Quellen' });
  }
  let st;
  try { st = await stat(abs); }
  catch { return res.status(404).json({ error: 'Pfad nicht erreichbar' }); }
  if (!st.isDirectory()) return res.status(400).json({ error: 'Pfad ist kein Ordner' });

  try {
    const dirents = await readdir(abs, { withFileTypes: true });
    const dirs = dirents.filter(d => d.isDirectory() && !d.name.startsWith('.'));
    const files = dirents.filter(d => d.isFile() && !d.name.startsWith('.') && isVideoExtension(d.name));
    const entries = [
      ...dirs.map(d => ({ name: d.name, kind: 'dir' as const })),
      ...await Promise.all(files.map(async f => {
        const full = path.join(abs, f.name);
        let size: number | undefined;
        let mtime: number | undefined;
        try {
          const fst = await stat(full);
          size = fst.size;
          mtime = fst.mtimeMs;
        } catch { /* ignore */ }
        return { name: f.name, kind: 'file' as const, size, mtime };
      })),
    ];
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'de');
    });
    const parent = abs === path.parse(abs).root ? null : path.dirname(abs);
    res.json({ path: abs, parent: parent && isPathWithinReferenceRoots(parent) ? parent : null, entries });
  } catch (err) {
    res.status(500).json({ error: `Verzeichnis konnte nicht gelesen werden: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/videos/add-reference — create symlink + registry entry for an external video
app.post('/api/backend/assets/videos/add-reference', async (req, res) => {
  const { sourcePath, subfolder, name } = req.body as {
    sourcePath?: string;
    subfolder?: string;
    name?: string;
  };
  if (!sourcePath || typeof sourcePath !== 'string') {
    return res.status(400).json({ error: 'sourcePath erforderlich' });
  }
  const absSource = path.resolve(sourcePath);
  if (!isPathWithinReferenceRoots(absSource)) {
    return res.status(403).json({ error: 'Quellpfad liegt außerhalb der erlaubten Quellen' });
  }
  if (subfolder && !isSafePath(subfolder)) {
    return res.status(400).json({ error: 'Ungültiger Unterordner' });
  }

  try {
    const srcStat = await stat(absSource);
    if (!srcStat.isFile()) return res.status(400).json({ error: 'Quellpfad ist keine Datei' });
    if (!isVideoExtension(absSource)) return res.status(400).json({ error: 'Keine unterstützte Video-Dateiendung' });

    const finalName = name && isSafePath(name) ? name : path.basename(absSource);
    if (!isVideoExtension(finalName)) {
      return res.status(400).json({ error: 'Zielname muss eine Video-Dateiendung haben' });
    }
    const videosDir = categoryDir('videos');
    const destDir = subfolder ? path.join(videosDir, subfolder) : videosDir;
    await mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, finalName);
    if (existsSync(destPath)) {
      return res.status(409).json({ error: `"${finalName}" existiert bereits in der DAM` });
    }

    // Create the symlink pointing at the absolute source path.
    const { symlink } = await import('fs/promises');
    await symlink(absSource, destPath);

    const relPath = subfolder ? `${subfolder}/${finalName}` : finalName;
    await addVideoReferenceEntry(videosDir, relPath, absSource);
    invalidateReferenceMapCache();
    invalidateVideoFilesCache();
    _storageStatsCache = null;

    // Same post-upload pipeline as a regular video upload: fetch poster in the background.
    const imagesDir = categoryDir('images');
    fetchAndSavePoster(finalName, imagesDir, (msg) => console.log(`[poster-auto] ${msg}`))
      .then(posterRelPath => {
        if (posterRelPath) {
          const slug = videoFilenameToSlug(finalName);
          queueNasCopy('images', `${MOVIE_POSTERS_SUBDIR}/${slug}.jpg`);
          broadcastAssetsChanged('images');
        }
      })
      .catch(() => {});

    broadcastAssetsChanged('videos');
    res.json({ fileName: finalName, relPath });
  } catch (err) {
    res.status(500).json({ error: `Referenz konnte nicht angelegt werden: ${(err as Error).message}` });
  }
});

/** One entry per in-flight faststart remux, keyed by relative file path. Each entry holds
 *  the promise (so a second client subscribes to the same ffmpeg process instead of
 *  starting a duplicate) and the set of per-request progress listeners. The ffmpeg process
 *  runs **independently** of the originating HTTP request — if the browser reloads or
 *  navigates, the remux keeps going and the next client that opens the file sees either the
 *  in-flight promise (and can subscribe to remaining progress) or the already-faststart
 *  probe result (the remux finished while the UI was gone). */
interface InflightFaststart {
  promise: Promise<void>;
  progressListeners: Set<(percent: number) => void>;
  /** Last known percent so late subscribers show something sensible immediately rather
   *  than waiting for the next ffmpeg progress tick. */
  lastPercent: number;
  taskId: string;
}
const inflightFaststart = new Map<string, InflightFaststart>();

/** Actual remux work. Spawns ffmpeg with `-progress pipe:1` so we can surface byte-level
 *  progress, runs to completion even if every listener has disconnected, and registers in
 *  the global background-tasks map so the System tab shows it + browser reloads don't
 *  lose track of what's happening. */
function runFaststartRemux(fullPath: string, filePath: string): InflightFaststart {
  const existing = inflightFaststart.get(filePath);
  if (existing) return existing;

  const progressListeners = new Set<(percent: number) => void>();
  const entry: InflightFaststart = { promise: Promise.resolve(), progressListeners, lastPercent: 0, taskId: '' };
  const taskId = bgTaskStart('faststart', `Faststart-Remux: ${path.basename(filePath)}`, '0 %');
  entry.taskId = taskId;

  const tmpPath = fullPath + '.faststart.tmp';
  entry.promise = (async () => {
    try { unlinkSync(tmpPath); } catch { /* no stale */ }
    // Duration from probe so we can compute percent from `out_time_ms`. Best-effort —
    // without it we still run, just without meaningful progress.
    let durationMs = 0;
    try {
      const { videoInfo } = await cachedProbe(fullPath, filePath);
      if (videoInfo?.duration) durationMs = Math.round(videoInfo.duration * 1000);
    } catch { /* keep durationMs=0 → percent stays at 0, task still finishes */ }

    const started = Date.now();
    const proc = spawnBackgroundFfmpeg([
      '-progress', 'pipe:1', '-nostats',
      '-i', fullPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-f', 'mp4',
      '-y', tmpPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const stderrChunks: string[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString()));
    proc.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        const m = line.match(/^out_time_ms=(\d+)/);
        if (m && durationMs > 0) {
          const pct = Math.min(95, Math.round((parseInt(m[1]) / 1000 / durationMs) * 100));
          if (pct !== entry.lastPercent) {
            entry.lastPercent = pct;
            bgTaskUpdate(taskId, `${pct} %`);
            for (const cb of progressListeners) { try { cb(pct); } catch { /* listener error isn't our problem */ } }
          }
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      proc.on('close', code => {
        if (code === 0) resolve();
        else {
          console.error(`[faststart] ffmpeg stderr:\n${stderrChunks.join('')}`);
          reject(new Error(`ffmpeg exit ${code}`));
        }
      });
      proc.on('error', reject);
    });

    renameSync(tmpPath, fullPath);
    probeResultCache.delete(filePath);
    entry.lastPercent = 100;
    for (const cb of progressListeners) { try { cb(100); } catch { /* ignore */ } }
    bgTaskDone(taskId);
    console.log(`[faststart] Done ${filePath} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    queueNasCopy('videos', filePath);
  })();

  // Always clean up the inflight map + any temp files on failure. The promise settles
  // regardless so dedup-subscribers don't hang.
  entry.promise.catch(err => {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    bgTaskError(taskId, (err as Error).message);
  }).finally(() => {
    inflightFaststart.delete(filePath);
  });

  inflightFaststart.set(filePath, entry);
  return entry;
}

/** POST /api/backend/assets/videos/faststart — kicks off a stream-copy remux that moves
 *  the `moov` atom to the start of the file so browsers can seek. Returns an SSE stream of
 *  `{ percent }` events, ending with `{ done: true }` or `{ error }`. The ffmpeg process
 *  is decoupled from the HTTP request: if the client disconnects (browser reload, tab
 *  close, navigation) the remux keeps running, and the next client that requests the same
 *  file either sees `alreadyFaststart: true` (done) or joins the in-flight progress stream
 *  (still running). */
app.post('/api/backend/assets/videos/faststart', async (req, res) => {
  const { filePath } = req.body as { filePath?: string };
  if (!filePath || !isSafePath(filePath)) return res.status(400).json({ error: 'Invalid path' });
  const fullPath = path.join(categoryDir('videos'), filePath);
  if (!existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });

  // If another request is already remuxing this file, join it. Otherwise, short-circuit
  // when the file is already faststart-clean (idempotent calls should be cheap).
  let entry = inflightFaststart.get(filePath);
  if (!entry) {
    try {
      const { videoInfo } = await cachedProbe(fullPath, filePath);
      if (videoInfo?.faststart) return res.json({ alreadyFaststart: true });
    } catch { /* proceed with remux anyway */ }
    entry = runFaststartRemux(fullPath, filePath);
  }

  // SSE setup — client gets percent updates until the promise settles.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (data: Record<string, unknown>) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
  };

  // Immediately flush the last known percent so a late subscriber (e.g. after reload) sees
  // progress right away rather than waiting for the next ffmpeg tick.
  send({ percent: entry.lastPercent });

  const listener = (pct: number) => send({ percent: pct });
  entry.progressListeners.add(listener);

  entry.promise.then(() => {
    send({ percent: 100, done: true });
  }).catch((err: Error) => {
    send({ error: err.message });
  }).finally(() => {
    entry!.progressListeners.delete(listener);
    try { res.end(); } catch { /* already closed */ }
  });
});

// GET /api/backend/assets/videos/faststart-status — lets a freshly-loaded client check
// whether a remux is currently running for a given file and pick up the progress stream.
// The SSE endpoint above dedup's on filePath, so after this call the client can POST
// again to subscribe.
app.get('/api/backend/assets/videos/faststart-status', (req, res) => {
  const filePath = req.query.path as string | undefined;
  if (!filePath || !isSafePath(filePath)) return res.status(400).json({ error: 'Invalid path' });
  const entry = inflightFaststart.get(filePath);
  res.json({ running: !!entry, percent: entry?.lastPercent ?? null });
});

// (Removed: `POST /api/backend/assets/videos/transcode` + `GET .../transcode-status`.
//  The full-file HDR→SDR and audio→AAC transcodes have no callers; segment caches and
//  track-remux cover every prior use case. See specs/video-caching.md §dead-paths.)

const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mkv', '.mov', '.webm', '.avi']);

// Cached video file listing (avoids repeated recursive directory walks)
let _videoFilesCache: { files: string[]; ts: number } | null = null;
const VIDEO_FILES_CACHE_TTL = 60_000; // 60s
async function getVideoFilesCached(dir: string): Promise<string[]> {
  if (_videoFilesCache && Date.now() - _videoFilesCache.ts < VIDEO_FILES_CACHE_TTL) return _videoFilesCache.files;
  const files = await collectVideoFiles(dir, '');
  _videoFilesCache = { files, ts: Date.now() };
  return files;
}
/** Invalidate video file listing cache (call after upload/delete/move). */
function invalidateVideoFilesCache(): void { _videoFilesCache = null; }

/**
 * Clean up stale .transcoding.* temp files left behind by interrupted transcodes.
 * Scans both local-assets/videos and NAS videos dir.
 */
async function cleanupStaleTranscodeFiles(): Promise<void> {
  const dirs = [categoryDir('videos')];
  if (isNasMounted()) dirs.push(path.join(NAS_BASE, 'videos'));

  for (const dir of dirs) {
    try {
      await cleanupTranscodingInDir(dir);
    } catch { /* dir may not exist */ }
  }
}

async function cleanupTranscodingInDir(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'backup') continue;
    const fullPath = path.join(dir, e.name);
    if (e.isDirectory()) {
      await cleanupTranscodingInDir(fullPath).catch(() => {});
    } else if (e.isFile() && e.name.includes('.transcoding.')) {
      console.log(`[cleanup] Removing stale transcode temp file: ${fullPath}`);
      await unlink(fullPath).catch(() => {});
    }
  }
}

// Recursively collect all video files relative to a base directory
async function collectVideoFiles(dir: string, prefix: string): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.includes('.transcoding.') || e.name === 'backup') continue;
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        result.push(...await collectVideoFiles(fullPath, prefix ? `${prefix}/${e.name}` : e.name));
      } else if (e.isFile() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) {
        result.push(prefix ? `${prefix}/${e.name}` : e.name);
      }
    }
  } catch { /* ignore unreadable dirs */ }
  return result;
}

// GET /api/backend/assets/videos/warm-preview — preview what warm-all would do
app.get('/api/backend/assets/videos/warm-preview', async (_req, res) => {
  const videosDir = categoryDir('videos');
  if (!existsSync(videosDir)) return res.json({ videos: [] });

  const relPaths = await getVideoFilesCached(videosDir);
  const videos: Array<{
    path: string;
    needsHdrProbe: boolean;
    isHdr: boolean | null;
  }> = [];

  for (const relPath of relPaths) {
    const hdrEntry = hdrCache.get(relPath);
    videos.push({
      path: relPath,
      needsHdrProbe: !hdrEntry,
      isHdr: hdrEntry?.isHdr ?? null,
    });
  }

  res.json({ videos });
});

// POST /api/backend/assets/videos/warm-all — warm HDR metadata for selected video files
app.post('/api/backend/assets/videos/warm-all', async (req, res) => {
  const videosDir = categoryDir('videos');
  if (!existsSync(videosDir)) return res.json({ queued: 0 });

  const { selected } = req.body as { selected?: Array<{ path: string; hdrProbe: boolean }> };

  // If no selection provided, warm everything (backward compat)
  const relPaths = selected
    ? selected.map(s => s.path)
    : await getVideoFilesCached(videosDir);

  const selectionMap = selected
    ? new Map(selected.map(s => [s.path, s]))
    : null;

  let queued = 0;

  for (const relPath of relPaths) {
    const fullPath = path.join(videosDir, relPath);
    if (!existsSync(fullPath)) continue;
    const sel = selectionMap?.get(relPath);
    const doHdrProbe = sel ? sel.hdrProbe : true;

    if (doHdrProbe && !hdrCache.has(relPath)) {
      const taskId = bgTaskStart('hdr-probe', `HDR-Probe: ${path.basename(relPath)}`, relPath);
      cachedProbe(fullPath, relPath).then(({ videoInfo }) => {
        if (videoInfo) {
          hdrCache.set(relPath, { isHdr: videoInfo.isHdr, maxCLL: videoInfo.maxCLL });
          saveHdrCache();
        }
        bgTaskDone(taskId);
      }).catch(err => bgTaskError(taskId, (err as Error).message));
    }

    queued++;
  }

  res.json({ queued });
});

// ── Audio cover fetch job tracking (survives page reload) ──
interface AudioCoverJobFile {
  name: string;
  phase: 'pending' | 'searching' | 'done' | 'error';
  coverPath?: string | null;
}
interface AudioCoverJob {
  id: string;
  phase: 'searching' | 'done' | 'error';
  fileIndex: number;
  fileCount: number;
  fileName: string;
  files: AudioCoverJobFile[];
  startedAt: number;
  error?: string;
}
const audioCoverJobs = new Map<string, AudioCoverJob>();
const audioCoverAbortControllers = new Map<string, AbortController>();
// Pending user confirmations: jobId:fileIndex → resolve function
const audioCoverConfirmations = new Map<string, (accept: boolean) => void>();

// GET /api/backend/audio-covers/list — list existing cover filenames.
// Also returns alias keys (e.g. from a prior DAM merge) whose resolved target
// exists on disk — so the picker treats an audio file whose derived cover
// has been merged away as "already covered" and doesn't offer a redundant
// re-fetch.
app.get('/api/backend/audio-covers/list', async (_req, res) => {
  const imagesDir = categoryDir('images');
  const coverDir = path.join(imagesDir, AUDIO_COVERS_SUBDIR);
  try {
    const onDisk = existsSync(coverDir)
      ? readdirSync(coverDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f))
      : [];
    const aliasMap = await readAliasMap(imagesDir);
    const onDiskSet = new Set(onDisk);
    const aliased = Object.keys(aliasMap).filter(k => onDiskSet.has(resolveAlias(aliasMap, k)));
    res.json({ covers: [...onDisk, ...aliased] });
  } catch (err) {
    res.status(500).json({ error: `Failed to list covers: ${(err as Error).message}` });
  }
});

// POST /api/backend/audio-cover-cancel/:jobId — cancel an active audio cover fetch
app.post('/api/backend/audio-cover-cancel/:jobId', (_req, res) => {
  const { jobId } = _req.params;
  const ac = audioCoverAbortControllers.get(jobId);
  if (!ac) return res.status(404).json({ error: 'Job not found or already finished' });
  ac.abort();
  // Resolve any pending confirmation so the loop can exit
  for (const [key, resolve] of audioCoverConfirmations) {
    if (key.startsWith(`${jobId}:`)) {
      resolve(false);
      audioCoverConfirmations.delete(key);
    }
  }
  res.json({ ok: true });
});

// DELETE /api/backend/audio-cover-job/:jobId — remove a finished job so polling never sees it again
app.delete('/api/backend/audio-cover-job/:jobId', (_req, res) => {
  audioCoverJobs.delete(_req.params.jobId);
  broadcast('audio-cover-status', { jobs: Array.from(audioCoverJobs.values()) });
  res.json({ ok: true });
});

// POST /api/backend/audio-cover-confirm/:jobId/:fileIndex — confirm or reject an uncertain cover match
app.post('/api/backend/audio-cover-confirm/:jobId/:fileIndex', (req, res) => {
  const key = `${req.params.jobId}:${req.params.fileIndex}`;
  const resolve = audioCoverConfirmations.get(key);
  if (!resolve) return res.status(404).json({ error: 'No pending confirmation' });
  const { accept } = req.body as { accept?: boolean };
  resolve(accept === true);
  audioCoverConfirmations.delete(key);
  res.json({ ok: true });
});

// POST /api/backend/audio-cover-fetch — batch fetch audio covers via SSE
app.post('/api/backend/audio-cover-fetch', async (req, res) => {
  const { files } = req.body as { files?: string[] };
  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'Missing or empty files array' });
  }

  const jobId = `ac-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const jobAbort = new AbortController();
  const job: AudioCoverJob = {
    id: jobId,
    phase: 'searching',
    fileIndex: 0,
    fileCount: files.length,
    fileName: '',
    files: files.map(name => ({ name, phase: 'pending' })),
    startedAt: Date.now(),
  };
  audioCoverJobs.set(jobId, job);
  audioCoverAbortControllers.set(jobId, jobAbort);
  broadcast('audio-cover-status', { jobs: Array.from(audioCoverJobs.values()) });

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data: Record<string, unknown>) => {
    if (data.phase && !data.fileIndex) job.phase = data.phase as AudioCoverJob['phase'];
    if (data.fileIndex != null) job.fileIndex = data.fileIndex as number;
    if (data.fileName != null) job.fileName = data.fileName as string;
    if (data.message && data.phase === 'error') job.error = data.message as string;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush();
    }
    broadcastThrottled('audio-cover-status', { jobs: Array.from(audioCoverJobs.values()) }, 1000);
  };

  send({ jobId });

  // Auto-cleanup
  res.on('finish', () => {
    audioCoverAbortControllers.delete(jobId);
    broadcast('audio-cover-status', { jobs: Array.from(audioCoverJobs.values()) });
    setTimeout(() => {
      const j = audioCoverJobs.get(jobId);
      if (j && (j.phase === 'done' || j.phase === 'error')) {
        audioCoverJobs.delete(jobId);
        broadcast('audio-cover-status', { jobs: Array.from(audioCoverJobs.values()) });
      }
    }, 60_000);
  });

  const imagesDir = categoryDir('images');

  for (let i = 0; i < files.length; i++) {
    if (jobAbort.signal.aborted) {
      send({ phase: 'error', message: 'Abgebrochen' });
      res.end();
      return;
    }

    const fileName = files[i];
    const fileIndex = i + 1;
    job.files[i].phase = 'searching';
    job.fileIndex = fileIndex;
    job.fileName = fileName;
    send({ phase: 'searching', fileIndex, fileCount: files.length, fileName });

    try {
      const result = await fetchAndSaveAudioCover(fileName, imagesDir, (msg) => {
        send({ phase: 'searching', fileIndex, fileCount: files.length, fileName, message: msg });
      }, (searchResult) => {
        // Send confirm event and wait for user response
        send({
          phase: 'confirm',
          fileIndex,
          fileCount: files.length,
          fileName,
          foundArtist: searchResult.artistName,
          foundTrack: searchResult.trackName,
          coverPreview: searchResult.url,
          source: searchResult.source,
        });
        return new Promise<boolean>((resolve) => {
          const key = `${jobId}:${fileIndex}`;
          audioCoverConfirmations.set(key, resolve);
          // Auto-reject after 2 minutes if no response
          setTimeout(() => {
            if (audioCoverConfirmations.has(key)) {
              audioCoverConfirmations.delete(key);
              resolve(false);
            }
          }, 120_000);
        });
      });

      const { coverPath, rateLimited, searchResult } = result;

      job.files[i].phase = coverPath ? 'done' : 'error';
      job.files[i].coverPath = coverPath;

      if (coverPath) {
        const coverName = audioCoverFilename(fileName);
        queueNasCopy('images', `${AUDIO_COVERS_SUBDIR}/${coverName}`);
        if (searchResult) {
          const actualCoverName = path.basename(coverPath);
          await setAudioCoverMeta(imagesDir, actualCoverName, {
            source: searchResult.source,
            setAt: Date.now(),
          });
        }
        broadcastAssetsChanged('images');
      }

      send({
        phase: 'searching',
        fileIndex,
        fileCount: files.length,
        fileName,
        coverPath,
        fileDone: true,
        filePhase: coverPath ? 'done' : 'error',
        ...(rateLimited ? { rateLimited: true } : {}),
      });
    } catch (err) {
      job.files[i].phase = 'error';
      send({
        phase: 'searching',
        fileIndex,
        fileCount: files.length,
        fileName,
        fileDone: true,
        filePhase: 'error',
        message: (err as Error).message,
      });
    }
  }

  job.phase = 'done';
  send({ phase: 'done', fileCount: files.length });
  res.end();
});

// ── Audio cover override / iTunes swap / source metadata ──────────────────────
// Canonical-path-copy: every audio's cover lives at /images/Audio-Covers/{basename}.jpg.
// Override operations rewrite the bytes at that path; game JSONs are never touched.
// Source tracked in .audio-cover-meta.json. See specs/audio-cover-override.md.

interface ItunesCandidate {
  audioFileName: string;
  candidate: CoverSearchResult;
  createdAt: number;
}
const itunesCoverCandidates = new Map<string, ItunesCandidate>();
const ITUNES_CANDIDATE_TTL_MS = 5 * 60 * 1000;

function pruneItunesCandidates(): void {
  const now = Date.now();
  for (const [token, c] of itunesCoverCandidates) {
    if (now - c.createdAt > ITUNES_CANDIDATE_TTL_MS) itunesCoverCandidates.delete(token);
  }
}

async function writeAudioCoverFromUrl(
  imagesDir: string,
  audioFileName: string,
  url: string,
  source: AudioCoverSource,
  origin?: { pickedFrom?: string },
): Promise<{ coverName: string; coverPath: string; version: number }> {
  const coverName = audioCoverFilename(path.basename(audioFileName));
  const coverDir = path.join(imagesDir, AUDIO_COVERS_SUBDIR);
  await mkdir(coverDir, { recursive: true });
  const destFull = path.join(coverDir, coverName);
  const buf = await fetchUrl(url);
  const tmpFull = `${destFull}.tmp`;
  await writeFile(tmpFull, buf);
  await rename(tmpFull, destFull);
  // Remove any stale archival YouTube Thumbnails/ sibling — the canonical cover
  // is now authoritative, so the archive would only confuse a future backfill.
  const ytFull = path.join(imagesDir, AUDIO_COVERS_SUBDIR, 'YouTube Thumbnails', coverName);
  if (existsSync(ytFull)) {
    try { await rm(ytFull); } catch { /* best-effort */ }
  }
  await setAudioCoverMeta(imagesDir, coverName, { source, setAt: Date.now(), ...(origin ? { origin } : {}) });
  queueNasCopy('images', `${AUDIO_COVERS_SUBDIR}/${coverName}`);
  const st = await stat(destFull);
  return { coverName, coverPath: `/images/${AUDIO_COVERS_SUBDIR}/${coverName}`, version: st.mtimeMs };
}

// GET /api/backend/audio-cover/meta — return the full source-metadata map.
app.get('/api/backend/audio-cover/meta', async (_req, res) => {
  const imagesDir = categoryDir('images');
  try {
    const meta = await readAudioCoverMeta(imagesDir);
    res.json({ meta });
  } catch (err) {
    res.status(500).json({ error: `Failed to read meta: ${(err as Error).message}` });
  }
});

// POST /api/backend/audio-cover/override — replace an audio's cover with an
// arbitrary image from the DAM. Body: { audioFileName, sourceImagePath }.
app.post('/api/backend/audio-cover/override', async (req, res) => {
  const { audioFileName, sourceImagePath } = req.body as { audioFileName?: string; sourceImagePath?: string };
  if (!audioFileName || !isSafePath(audioFileName)) {
    return res.status(400).json({ error: 'Invalid audioFileName' });
  }
  if (!sourceImagePath || typeof sourceImagePath !== 'string') {
    return res.status(400).json({ error: 'Invalid sourceImagePath' });
  }
  // Accept both "/images/foo.jpg" (frontend storage form) and "foo.jpg" (raw rel).
  const imageRel = sourceImagePath.replace(/^\/images\//, '').replace(/^\/+/, '');
  if (!imageRel || !isSafePath(imageRel)) {
    return res.status(400).json({ error: 'Invalid sourceImagePath' });
  }
  const imagesDir = categoryDir('images');
  const audioFull = path.join(categoryDir('audio'), audioFileName);
  const sourceFull = path.join(imagesDir, imageRel);
  const coverName = audioCoverFilename(path.basename(audioFileName));
  const coverDir = path.join(imagesDir, AUDIO_COVERS_SUBDIR);
  const destFull = path.join(coverDir, coverName);
  try {
    const [audioStat, srcStat] = await Promise.all([stat(audioFull), stat(sourceFull)]);
    if (!audioStat.isFile()) return res.status(400).json({ error: 'Audio file not found' });
    if (!srcStat.isFile()) return res.status(400).json({ error: 'Source image not found' });
    if (path.resolve(sourceFull) === path.resolve(destFull)) {
      return res.status(400).json({ error: 'same_path' });
    }
    await mkdir(coverDir, { recursive: true });
    const tmpFull = `${destFull}.tmp`;
    await copyFile(sourceFull, tmpFull);
    await rename(tmpFull, destFull);
    const ytFull = path.join(imagesDir, AUDIO_COVERS_SUBDIR, 'YouTube Thumbnails', coverName);
    if (existsSync(ytFull)) {
      try { await rm(ytFull); } catch { /* best-effort */ }
    }
    await setAudioCoverMeta(imagesDir, coverName, {
      source: 'manual',
      setAt: Date.now(),
      origin: { pickedFrom: `/images/${imageRel}` },
    });
    queueNasCopy('images', `${AUDIO_COVERS_SUBDIR}/${coverName}`);
    broadcastAssetsChanged('images');
    const st = await stat(destFull);
    res.json({ success: true, coverPath: `/images/${AUDIO_COVERS_SUBDIR}/${coverName}`, version: st.mtimeMs });
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'File not found'
      : `Failed to override cover: ${(err as Error).message}`;
    res.status(500).json({ error: msg });
  }
});

// POST /api/backend/audio-cover/itunes — fetch an iTunes cover and overwrite the
// canonical cover. Confident matches apply immediately; unconfident matches return
// a short-lived confirmToken that the client echoes back on a second call.
app.post('/api/backend/audio-cover/itunes', async (req, res) => {
  pruneItunesCandidates();
  const { audioFileName, confirmToken } = req.body as { audioFileName?: string; confirmToken?: string };
  if (!audioFileName || !isSafePath(audioFileName)) {
    return res.status(400).json({ error: 'Invalid audioFileName' });
  }
  const imagesDir = categoryDir('images');
  const audioFull = path.join(categoryDir('audio'), audioFileName);
  try {
    const audioStat = await stat(audioFull);
    if (!audioStat.isFile()) return res.status(400).json({ error: 'Audio file not found' });
  } catch {
    return res.status(400).json({ error: 'Audio file not found' });
  }

  if (confirmToken) {
    const cached = itunesCoverCandidates.get(confirmToken);
    if (!cached || cached.audioFileName !== audioFileName) {
      return res.status(404).json({ error: 'Confirm token expired or not found' });
    }
    itunesCoverCandidates.delete(confirmToken);
    try {
      const { coverPath, version } = await writeAudioCoverFromUrl(
        imagesDir,
        audioFileName,
        cached.candidate.url,
        'itunes',
      );
      broadcastAssetsChanged('images');
      return res.json({ success: true, coverPath, version, source: 'itunes' });
    } catch (err) {
      return res.status(500).json({ error: `Failed to save cover: ${(err as Error).message}` });
    }
  }

  const query = audioFilenameToSearchQuery(path.basename(audioFileName));
  if (!query.trim()) return res.status(400).json({ error: 'Could not derive search query' });
  const result = await searchItunes(query, () => {});
  if (result === 'RATE_LIMITED') return res.status(429).json({ error: 'rate_limited' });
  if (!result) return res.status(404).json({ error: 'no_match' });
  if (result.confident) {
    try {
      const { coverPath, version } = await writeAudioCoverFromUrl(
        imagesDir,
        audioFileName,
        result.url,
        'itunes',
      );
      broadcastAssetsChanged('images');
      return res.json({ success: true, coverPath, version, source: 'itunes' });
    } catch (err) {
      return res.status(500).json({ error: `Failed to save cover: ${(err as Error).message}` });
    }
  }
  const token = `it-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  itunesCoverCandidates.set(token, { audioFileName, candidate: result, createdAt: Date.now() });
  res.json({
    confirmRequired: true,
    confirmToken: token,
    candidate: {
      artist: result.artistName,
      track: result.trackName,
      url: result.url,
      source: result.source,
    },
  });
});

// GET /api/backend/assets/videos/sdr-cache-status — check if an SDR cache file exists
app.get('/api/backend/assets/videos/sdr-cache-status', (req, res) => {
  const video = req.query.video as string | undefined;
  const startSec = parseFloat(req.query.start as string);
  const endSec = parseFloat(req.query.end as string);
  const trackIdx = req.query.track !== undefined ? parseInt(req.query.track as string) : undefined;
  if (!video || isNaN(startSec) || isNaN(endSec) || endSec <= startSec) {
    return res.status(400).json({ cached: false });
  }
  const relPath = video.replace(/^\/videos\//, '');
  if (!isSafePath(relPath)) return res.status(400).json({ cached: false });
  const cacheFile = sdrCacheFile(relPath, startSec, endSec) + (trackIdx !== undefined ? `.t${trackIdx}` : '');
  const cached = sdrCacheReady.has(cacheFile) || existsSync(cacheFile);
  if (cached) sdrCacheReady.add(cacheFile);
  res.json({ cached });
});

// GET /api/backend/assets/videos/cached-tracks — list which track variants have
// cache files on disk for a given (video, start, end). Used by the offline language
// picker to restrict the options to languages whose caches actually exist.
app.get('/api/backend/assets/videos/cached-tracks', (req, res) => {
  const video = req.query.video as string | undefined;
  const startSec = parseFloat(req.query.start as string);
  const endSec = parseFloat(req.query.end as string);
  if (!video || isNaN(startSec) || isNaN(endSec) || endSec <= startSec) {
    return res.status(400).json({ compressed: [], sdr: [] });
  }
  const relPath = video.replace(/^\/videos\//, '');
  if (!isSafePath(relPath)) return res.status(400).json({ compressed: [], sdr: [] });

  const baseName = path.basename(compressedCacheFile(relPath, startSec, endSec));
  const pickTracks = (dirAbs: string): { tracks: number[]; hasNoTrack: boolean } => {
    const tracks = new Set<number>();
    let hasNoTrack = false;
    try {
      for (const f of readdirSync(dirAbs)) {
        if (f === baseName) { hasNoTrack = true; continue; }
        if (!f.startsWith(baseName + '.t')) continue;
        const suffix = f.slice((baseName + '.t').length);
        const n = parseInt(suffix, 10);
        if (!isNaN(n) && n >= 0) tracks.add(n);
      }
    } catch { /* dir missing */ }
    return { tracks: Array.from(tracks).sort((a, b) => a - b), hasNoTrack };
  };
  const compressed = pickTracks(path.join(VIDEO_CACHE_BASE, 'compressed'));
  const sdr = pickTracks(path.join(VIDEO_CACHE_BASE, 'sdr'));
  res.json({
    compressed: compressed.tracks,
    sdr: sdr.tracks,
    hasNoTrackCompressed: compressed.hasNoTrack,
    hasNoTrackSdr: sdr.hasNoTrack,
  });
});

// GET /api/backend/assets/videos/cache-check — check if a compressed segment cache exists
app.get('/api/backend/assets/videos/cache-check', (req, res) => {
  const type = req.query.type as string;
  const relPath = req.query.path as string;
  const startSec = parseFloat(req.query.start as string);
  const endSec = parseFloat(req.query.end as string);
  const trackIdx = req.query.track !== undefined ? parseInt(req.query.track as string) : undefined;

  if (!relPath || !isSafePath(relPath)) return res.json({ cached: false });

  if (type === 'compressed') {
    if (isNaN(startSec) || isNaN(endSec) || endSec <= startSec) return res.json({ cached: false });
    const cacheFile = compressedCacheFile(relPath, startSec, endSec) + (trackIdx !== undefined ? `.t${trackIdx}` : '');
    const cached = compressedCacheReady.has(cacheFile) || existsSync(cacheFile);
    if (cached) compressedCacheReady.add(cacheFile);
    return res.json({ cached });
  }

  res.json({ cached: false });
});

/** Shared SSE warmup handler for both compressed and sdr segment caches. Streams percent
 *  events, handles idle-cancel, writes through runSegmentEncode() which uses the shared queue.
 */
async function handleSegmentWarmup(kind: 'compressed' | 'sdr', req: express.Request, res: express.Response) {
  const { video, start: startSec, end: endSec, track: trackIdx } = req.body as { video?: string; start?: number; end?: number; track?: number };
  if (!video || startSec === undefined || endSec === undefined || endSec <= startSec) {
    return res.status(400).json({ error: 'Invalid params' });
  }
  if (trackIdx !== undefined && (isNaN(trackIdx) || trackIdx < 0)) {
    return res.status(400).json({ error: 'Invalid track' });
  }
  const relPath = video.replace(/^\/videos\//, '');
  if (!isSafePath(relPath)) return res.status(400).json({ error: 'Invalid path' });

  const fullPath = resolveVideoPath(relPath);
  if (!fullPath) return res.status(404).json({ error: 'File not found' });

  const cacheFile = (kind === 'sdr' ? sdrCacheFile(relPath, startSec, endSec) : compressedCacheFile(relPath, startSec, endSec))
    + (trackIdx !== undefined ? `.t${trackIdx}` : '');
  const readySet = kind === 'sdr' ? sdrCacheReady : compressedCacheReady;

  if (readySet.has(cacheFile) || existsSync(cacheFile)) {
    readySet.add(cacheFile);
    console.log(`[${kind}-warmup] Already cached: ${relPath} [${startSec}s–${endSec}s]`);
    return res.json({ done: true, cached: true });
  }

  // SSE setup
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (data: Record<string, unknown>) => {
    // res.write may throw if the client has closed; swallow silently.
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
  };

  // The idle-cancel hook (abort ffmpeg if the client disconnected for > 10 s) was removed:
  // Express/Node was firing `req.on('close')` during the SSE stream even while the curl/
  // browser client was still connected, which caused the idle timer to expire and SIGTERM
  // a healthy encode — surfacing as `ffmpeg exit 255` at ~90 %. A truly orphaned encode is
  // cheap: it just finishes and populates the cache for the next request. No abort needed.
  const ac = new AbortController();

  const taskId = bgTaskQueue(kind === 'sdr' ? 'sdr-warmup' : 'compressed-warmup',
    `${kind === 'sdr' ? 'SDR' : 'Compressed'}-Warmup: ${path.basename(relPath)}`,
    `${startSec}s–${endSec}s`,
    { video: relPath, start: startSec, end: endSec, track: trackIdx, kind });

  try {
    await runSegmentEncode({
      kind, fullPath, relPath, startSec, endSec, trackIdx, cacheFile,
      onProgress: (pct) => { send({ percent: pct }); bgTaskUpdate(taskId, `${pct} %`); },
      signal: ac.signal,
      taskId,
    });
    send({ percent: 100, done: true });
    bgTaskDone(taskId);
  } catch (err) {
    const msg = (err as Error).message;
    send({ error: msg });
    bgTaskError(taskId, msg);
  } finally {
    try { res.end(); } catch { /* already closed */ }
  }
}

// POST /api/backend/assets/videos/warmup-sdr — pre-transcode an HDR segment to SDR with progress
// Returns SSE stream: data: { percent: number } events, then data: { done: true } or { error: string }
app.post('/api/backend/assets/videos/warmup-sdr', (req, res) => handleSegmentWarmup('sdr', req, res));

// POST /api/backend/assets/videos/warmup-compressed — pre-transcode a SDR segment with progress.
// Same SSE shape as warmup-sdr; used for SDR videos with time markers.
app.post('/api/backend/assets/videos/warmup-compressed', (req, res) => handleSegmentWarmup('compressed', req, res));

/** One missing cache entry: what the pre-flight needs to generate. */
interface MissingCache {
  game: string;
  instance: string | null;
  questionIndex: number;
  video: string;
  start: number;
  end: number;
  track: number | undefined;
  kind: 'compressed' | 'sdr';
}

/** Enumerate the active gameshow's gameOrder and return a list of segment caches that
 *  should exist (one per video-guess question with time markers) but don't yet. Uses the
 *  HDR cache to decide whether the compressed or sdr variant is needed — if we don't know
 *  (HDR not probed yet), we assume SDR, which is the most common case.
 *  With `allLanguages`, expand each question into one cache entry per unique language
 *  track on the underlying video (picking the first track for each language). */
async function computeMissingCaches(
  gameOrder: string[],
  opts: { allLanguages?: boolean } = {},
): Promise<MissingCache[]> {
  const missing: MissingCache[] = [];
  for (const ref of gameOrder) {
    const { gameName, instanceName } = parseGameRef(ref);
    let cfg: GameConfig;
    try { cfg = await loadGameConfig(gameName, instanceName); }
    catch { continue; }
    if (cfg.type !== 'video-guess') continue;
    const questions = cfg.questions ?? [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const video = q.video;
      if (!video) continue;
      const questionEnd = q.videoQuestionEnd;
      const answerEnd = q.videoAnswerEnd;
      if (questionEnd === undefined && answerEnd === undefined) continue; // no segment needed
      const segStart = q.videoStart ?? 0;
      const segEnd = Math.max(questionEnd ?? segStart, answerEnd ?? 0);
      const relPath = video.replace(/^\/videos\//, '');

      const isHdr = !!hdrCache.get(relPath)?.isHdr;
      const kind: 'compressed' | 'sdr' = isHdr ? 'sdr' : 'compressed';

      let tracksToWarm: (number | undefined)[] = [q.audioTrack];
      if (opts.allLanguages) {
        const fullPath = resolveVideoPath(relPath);
        if (fullPath) {
          try {
            const { tracks } = await cachedProbe(fullPath, relPath);
            const seen = new Set<string>();
            const picked: number[] = [];
            for (let ti = 0; ti < tracks.length; ti++) {
              const lang = tracks[ti].language || `_track${ti}`;
              if (seen.has(lang)) continue;
              seen.add(lang);
              picked.push(ti);
            }
            if (picked.length > 0) tracksToWarm = picked;
          } catch {
            // Probe failed — fall back to the question's configured track.
          }
        }
      }

      for (const track of tracksToWarm) {
        const cacheFile = (kind === 'sdr' ? sdrCacheFile(relPath, segStart, segEnd) : compressedCacheFile(relPath, segStart, segEnd))
          + (track !== undefined ? `.t${track}` : '');
        const readySet = kind === 'sdr' ? sdrCacheReady : compressedCacheReady;
        // Disk is authoritative — the in-memory set can drift (e.g. a cache file was deleted
        // out of band). Sync the set to match disk, then decide.
        if (existsSync(cacheFile)) {
          readySet.add(cacheFile);
          continue;
        }
        readySet.delete(cacheFile);
        missing.push({ game: gameName, instance: instanceName, questionIndex: i, video, start: segStart, end: segEnd, track, kind });
      }
    }
  }
  return missing;
}

// GET /api/backend/cache-status — pre-flight check: which video-guess segment caches are
// missing for the active (or given) gameshow. Used by HomeScreen to warn the operator.
app.get('/api/backend/cache-status', async (req, res) => {
  try {
    const config = await loadConfig();
    const gameshowKey = (req.query.gameshow as string | undefined) ?? config.activeGameshow;
    const gs = config.gameshows[gameshowKey];
    if (!gs) return res.status(404).json({ error: `Gameshow "${gameshowKey}" not found` });
    const allLanguages = req.query.allLanguages === '1' || req.query.allLanguages === 'true';
    const missing = await computeMissingCaches(gs.gameOrder, { allLanguages });
    res.json({ gameshow: gameshowKey, total: gs.gameOrder.length, missing });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Active warm-all AbortController — set while `/cache-warm-all` is running, cleared on
// completion. `POST /cache-warm-all/cancel` aborts through this so the user can cancel
// even after a page reload (the SSE observer is ephemeral, but the encodes aren't).
let activeCacheWarmAllAbort: AbortController | null = null;

// POST /api/backend/cache-warm-all — warm all missing video caches for the active gameshow
// (or the one in ?gameshow=) through the shared bg-encode queue. Streams SSE progress:
//   data: { index, total, current: { game, questionIndex, video }, percent, phase } ...
//   data: { done: true, warmed: N, failed: [{ …, error }] }
//
// A client disconnect (reload, navigation) does NOT abort the encodes — the SSE stream
// is just the observer. Progress remains visible via the `system-status` WebSocket, and
// the queued/running tasks are already registered in `bgTaskQueue`. This matches the
// single-segment warmup endpoints (see `handleSegmentWarmup`). Explicit cancel must go
// through `POST /cache-warm-all/cancel`.
app.post('/api/backend/cache-warm-all', async (req, res) => {
  let config: AppConfig;
  try { config = await loadConfig(); }
  catch (err) { return res.status(500).json({ error: (err as Error).message }); }
  const gameshowKey = (req.query.gameshow as string | undefined) ?? config.activeGameshow;
  const gs = config.gameshows[gameshowKey];
  if (!gs) return res.status(404).json({ error: `Gameshow "${gameshowKey}" not found` });

  const allLanguages = req.query.allLanguages === '1' || req.query.allLanguages === 'true';
  const missing = await computeMissingCaches(gs.gameOrder, { allLanguages });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (data: Record<string, unknown>) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
  };

  if (missing.length === 0) {
    send({ done: true, warmed: 0, failed: [] });
    return res.end();
  }

  const ac = new AbortController();
  activeCacheWarmAllAbort = ac;

  // Inner-parallel / outer-sequential: create a queued bgTask for every missing
  // entry up-front and fire the encodes concurrently so the whole queue appears
  // in the System tab (gated by BG_ENCODE_CONCURRENCY=2). The outer loop walks
  // the promises in order to preserve the banner's `{ index, total, current }`
  // SSE contract — `percent` for the current row still flows via the dedup
  // fanout even while later entries race in the background.
  interface WarmItem {
    entry: MissingCache;
    promise: Promise<void> | null;
    sourceMissing: boolean;
  }
  const items: WarmItem[] = missing.map((entry, idx): WarmItem => {
    const relPath = entry.video.replace(/^\/videos\//, '');
    const fullPath = resolveVideoPath(relPath);
    if (!fullPath) return { entry, promise: null, sourceMissing: true };
    const cacheFile = (entry.kind === 'sdr' ? sdrCacheFile(relPath, entry.start, entry.end) : compressedCacheFile(relPath, entry.start, entry.end))
      + (entry.track !== undefined ? `.t${entry.track}` : '');
    const taskId = bgTaskQueue(entry.kind === 'sdr' ? 'sdr-warmup' : 'compressed-warmup',
      `${entry.kind === 'sdr' ? 'SDR' : 'Compressed'}-Warmup: ${path.basename(relPath)}`,
      `${entry.start}s–${entry.end}s`,
      { video: relPath, start: entry.start, end: entry.end, track: entry.track, kind: entry.kind });
    const promise = runSegmentEncode({
      kind: entry.kind, fullPath, relPath,
      startSec: entry.start, endSec: entry.end, trackIdx: entry.track, cacheFile,
      onProgress: (pct) => {
        send({ index: idx, total: missing.length, current: entry, percent: pct, phase: 'encoding' });
        bgTaskUpdate(taskId, `${pct} %`);
      },
      signal: ac.signal,
      taskId,
    }).then(
      () => { bgTaskDone(taskId); },
      (err: Error) => { bgTaskError(taskId, err.message); throw err; },
    );
    // Promises run concurrently here but are awaited sequentially below. Attach a noop
    // catch so a rejection that lands before its turn isn't flagged as unhandled
    // (Node 25 default = process termination — was crashing the entire server on a
    // single bad source file). `.catch()` returns a new promise without changing
    // `promise`'s state, so the outer `await promise!` still throws into the
    // try/catch that records the failure in `failed[]`.
    promise.catch(() => { /* awaited below */ });
    return { entry, promise, sourceMissing: false };
  });

  const failed: Array<MissingCache & { error: string }> = [];
  let warmed = 0;
  for (let idx = 0; idx < items.length; idx++) {
    if (ac.signal.aborted) break;
    const { entry, promise, sourceMissing } = items[idx];
    if (sourceMissing) {
      failed.push({ ...entry, error: 'Source video not found' });
      send({ index: idx, total: missing.length, current: entry, percent: 0, error: 'Source video not found' });
      continue;
    }
    try {
      send({ index: idx, total: missing.length, current: entry, percent: 0, phase: 'starting' });
      await promise!;
      warmed++;
      send({ index: idx, total: missing.length, current: entry, percent: 100, phase: 'done' });
    } catch (err) {
      failed.push({ ...entry, error: (err as Error).message });
      send({ index: idx, total: missing.length, current: entry, percent: 0, error: (err as Error).message });
    }
  }
  send({ done: true, warmed, failed });
  if (activeCacheWarmAllAbort === ac) activeCacheWarmAllAbort = null;
  try { res.end(); } catch { /* already closed */ }
});

// POST /api/backend/cache-warm-all/cancel — abort the active warm-all run.
// Needed because client disconnect no longer aborts (see comment on /cache-warm-all).
app.post('/api/backend/cache-warm-all/cancel', (_req, res) => {
  if (activeCacheWarmAllAbort) {
    activeCacheWarmAllAbort.abort();
    activeCacheWarmAllAbort = null;
    return res.json({ cancelled: true });
  }
  res.json({ cancelled: false });
});

// POST /api/backend/assets/:category/mkdir — create an empty folder
app.post('/api/backend/assets/:category/mkdir', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const { folderPath } = req.body as { folderPath?: string };
  if (!folderPath || !isSafePath(folderPath)) return res.status(400).json({ error: 'Invalid folderPath' });
  try {
    await mkdir(path.join(categoryDir(category), folderPath), { recursive: true });
    queueNasMkdir(category, folderPath);
    broadcastAssetsChanged(category as AssetCategory);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to create folder: ${(err as Error).message}` });
  }
});

// DELETE /api/backend/assets/:category/*splat — soft-delete via `.trash/<batchId>/`.
//
// The target is renamed into a trash subfolder, not removed from disk. NAS deletion is
// deferred until the batch is purged (either on the next delete batch or via startup TTL),
// so an undo-delete call can still recover NAS-resident files.
//
// Query param `?batchId=<id>` groups multiple DELETEs from one bulk operation under the
// same batch — all items get restored together on undo. If absent, a fresh batchId is
// minted per call. Supplying a batchId that differs from the current `lastDeletion`
// triggers a purge of the previous batch before the new one is recorded.
app.delete('/api/backend/assets/:category/*splat', async (req, res) => {
  const { category } = req.params;
  if (typeof category !== 'string' || !isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const splat = req.params.splat;
  const filePath = Array.isArray(splat) ? splat.join('/') : splat;
  if (!filePath || !isSafePath(filePath)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  // Block `.`-prefixed path components so users cannot target `.trash`, caches, etc.
  if (filePath.split('/').some(seg => seg.startsWith('.'))) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const fullPath = path.join(categoryDir(category), filePath);

  const queryBatchId = typeof req.query.batchId === 'string' ? req.query.batchId : '';
  // Accept only simple ids (letters/digits/dashes) to avoid path-traversal into .trash.
  const safeBatchId = /^[a-zA-Z0-9_-]{6,64}$/.test(queryBatchId) ? queryBatchId : '';

  // Reference videos (symlinks) are removed directly — the source file is never touched.
  // No trash, no NAS delete queue. See specs/video-references.md.
  if (category === 'videos') {
    const references = await getReferenceMapCached();
    if (references[filePath]) {
      try {
        await unlink(fullPath); // removes the symlink, not the target
      } catch { /* link may already be gone */ }
      await removeVideoReferenceEntry(categoryDir('videos'), filePath);
      invalidateReferenceMapCache();
      invalidateVideoFilesCache();
      _storageStatsCache = null;
      deleteCacheFilesForVideo(filePath);
      sdrCacheReady.clear();
      compressedCacheReady.clear();
      hdrCache.delete(filePath);
      probeResultCache.delete(filePath);
      saveHdrCache();
      broadcastAssetsChanged('videos');
      return res.json({ success: true, reference: true });
    }
  }

  try {
    const st = await stat(fullPath);
    const isDirectory = st.isDirectory();

    // Determine effective batchId. Purge the previous batch if the category or id changes.
    const effectiveBatchId = safeBatchId || `${Date.now()}-${randomUUID().slice(0, 8)}`;
    if (lastDeletion && (lastDeletion.batchId !== effectiveBatchId || lastDeletion.category !== category)) {
      const toPurge = lastDeletion;
      lastDeletion = null;
      await purgeDeletionBatch(toPurge);
    }

    // Move into trash.
    const batchDir = trashBatchDir(category, effectiveBatchId);
    const trashPath = path.join(batchDir, filePath);
    await mkdir(path.dirname(trashPath), { recursive: true });
    await rename(fullPath, trashPath);

    // Mirror the soft-delete on NAS so the sync algorithm never sees an
    // asymmetric "missing local, present NAS" window — the source of the
    // file-restore regression that motivated symmetric trash.
    queueNasMoveToTrash(category, filePath, effectiveBatchId);

    // Append to the current batch record.
    if (!lastDeletion) {
      lastDeletion = { batchId: effectiveBatchId, category, entries: [], createdAt: Date.now() };
    }
    lastDeletion.entries.push({ originalPath: filePath, trashPath, isDirectory });

    _storageStatsCache = null;
    // Invalidate video caches — file is no longer at its original path. Cache entries would
    // otherwise reference a vanished file. On undo, next access re-probes.
    if (category === 'videos') {
      invalidateVideoFilesCache();
      deleteCacheFilesForVideo(filePath);
      sdrCacheReady.clear();
      compressedCacheReady.clear();
      hdrCache.delete(filePath);
      probeResultCache.delete(filePath);
      saveHdrCache();
    }
    broadcastAssetsChanged(category as AssetCategory);
    res.json({ success: true, batchId: effectiveBatchId });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// POST /api/backend/assets/undo-delete — restore the last delete batch from `.trash/`.
// Returns { success, restored, conflicts } where `conflicts` lists paths that could not
// be restored because a new file has taken their place at the original location.
app.post('/api/backend/assets/undo-delete', async (_req, res) => {
  if (!lastDeletion) return res.status(404).json({ error: 'Nothing to undo' });
  const { category, batchId } = lastDeletion;
  const result = await restoreTrashEntries(category, batchId, undefined);

  _storageStatsCache = null;
  if (category === 'videos') {
    invalidateVideoFilesCache();
    sdrCacheReady.clear();
    compressedCacheReady.clear();
  }
  broadcastAssetsChanged(category);
  res.json({ success: true, ...result });
});

// ── Papierkorb (trash view) ─────────────────────────────────────────────────
// Four endpoints back the DAM's `.trash/` view: list every surviving soft-delete
// batch for a category, restore selected entries, permanently delete (with optional
// audio-cover cascade), and stream individual file bytes for the preview modal.
// `express.static` is configured `dotfiles: 'ignore'` so the stream endpoint is
// the only way to fetch a trashed file over HTTP. See specs/admin-backend.md
// "Papierkorb (trash view)" and "Trash endpoints" for the contract.

app.get('/api/backend/assets/:category/trash', async (req, res) => {
  const { category } = req.params;
  if (typeof category !== 'string' || !isSafeCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  try {
    const batches = await listTrashBatches(category);
    res.json({ batches });
  } catch (err) {
    res.status(500).json({ error: `Failed to list trash: ${(err as Error).message}` });
  }
});

// Deep-flat listing of every trashed file across every batch. Backs the
// Papierkorb search input — `/trash` alone is not enough because it collapses
// soft-deleted folders into single rows, hiding files nested inside them.
app.get('/api/backend/assets/:category/trash/all', async (req, res) => {
  const { category } = req.params;
  if (typeof category !== 'string' || !isSafeCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  try {
    const entries = await listAllTrashFiles(category);
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: `Failed to list trash files: ${(err as Error).message}` });
  }
});

// Lazy children listing for the Papierkorb folder-navigation UI. Returns the
// direct children of `<batchDir>/<path>` — no single-child folder unwrapping
// so the user sees the actual structure when drilling in.
app.get('/api/backend/assets/:category/trash/list', async (req, res) => {
  const { category } = req.params;
  if (typeof category !== 'string' || !isSafeCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : '';
  const p = typeof req.query.path === 'string' ? req.query.path : '';
  if (!TRASH_BATCH_ID_RE.test(batchId)) return res.status(400).json({ error: 'Invalid batchId' });
  if (p !== '') {
    try { assertSafeTrashOriginalPath(p); }
    catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  }
  try {
    const entries = await listBatchChildren(category, batchId, p);
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: `Failed to list trash children: ${(err as Error).message}` });
  }
});

app.post('/api/backend/assets/:category/trash/restore', async (req, res) => {
  const { category } = req.params;
  if (typeof category !== 'string' || !isSafeCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const { batchId, items } = (req.body ?? {}) as { batchId?: unknown; items?: unknown };
  if (typeof batchId !== 'string' || !TRASH_BATCH_ID_RE.test(batchId)) {
    return res.status(400).json({ error: 'Invalid batchId' });
  }
  let normalizedItems: string[] | undefined;
  if (items !== undefined) {
    if (!Array.isArray(items) || items.some(s => typeof s !== 'string')) {
      return res.status(400).json({ error: 'items must be string[]' });
    }
    try { for (const s of items as string[]) assertSafeTrashOriginalPath(s); }
    catch (err) { return res.status(400).json({ error: (err as Error).message }); }
    normalizedItems = items as string[];
  }
  try {
    const result = await restoreTrashEntries(category, batchId, normalizedItems);
    _storageStatsCache = null;
    if (category === 'videos') {
      invalidateVideoFilesCache();
      sdrCacheReady.clear();
      compressedCacheReady.clear();
    }
    broadcastAssetsChanged(category);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: `Failed to restore: ${(err as Error).message}` });
  }
});

app.post('/api/backend/assets/:category/trash/purge', async (req, res) => {
  const { category } = req.params;
  if (typeof category !== 'string' || !isSafeCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const { batchId, items } = (req.body ?? {}) as { batchId?: unknown; items?: unknown };
  let normalizedBatchId: string | undefined;
  if (batchId !== undefined) {
    if (typeof batchId !== 'string' || !TRASH_BATCH_ID_RE.test(batchId)) {
      return res.status(400).json({ error: 'Invalid batchId' });
    }
    normalizedBatchId = batchId;
  }
  let normalizedItems: string[] | undefined;
  if (items !== undefined) {
    if (!Array.isArray(items) || items.some(s => typeof s !== 'string')) {
      return res.status(400).json({ error: 'items must be string[]' });
    }
    try { for (const s of items as string[]) assertSafeTrashOriginalPath(s); }
    catch (err) { return res.status(400).json({ error: (err as Error).message }); }
    normalizedItems = items as string[];
  }
  if (normalizedItems && !normalizedBatchId) {
    return res.status(400).json({ error: 'items requires a batchId' });
  }
  try {
    const result = await purgeTrashEntries(category, { batchId: normalizedBatchId, items: normalizedItems });
    _storageStatsCache = null;
    if (category === 'videos') {
      invalidateVideoFilesCache();
      sdrCacheReady.clear();
      compressedCacheReady.clear();
    }
    broadcastAssetsChanged(category);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: `Failed to purge: ${(err as Error).message}` });
  }
});

app.get('/api/backend/assets/:category/trash/stream', async (req, res) => {
  const { category } = req.params;
  if (typeof category !== 'string' || !isSafeCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : '';
  const p = typeof req.query.path === 'string' ? req.query.path : '';
  if (!TRASH_BATCH_ID_RE.test(batchId)) return res.status(400).json({ error: 'Invalid batchId' });
  try { assertSafeTrashOriginalPath(p); }
  catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  const full = path.join(trashBatchDir(category, batchId), p);
  try {
    const st = await stat(full);
    if (!st.isFile()) return res.status(404).json({ error: 'Not a file' });
  } catch {
    return res.status(404).json({ error: 'Trash entry not found' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(full, { dotfiles: 'allow' }, err => {
    if (err && !res.headersSent) res.status(500).json({ error: (err as Error).message });
  });
});

// ── Whisper transcription jobs (per-video, persistent, signal-controllable) ──
//
// Wired up here just before the SPA fallback so the /whisper/* routes win over the catch-all
// HTML responder. The jobs API itself is in `whisper-jobs.ts`; this block only mounts HTTP
// endpoints, runs reconciliation on startup, and flushes state on SIGTERM/SIGINT.
const whisperJobs = setupWhisperJobs({
  localAssetsBase: LOCAL_ASSETS_BASE,
  resolveVideoPath,
  cacheSlug,
  // Wrap bgTaskStart so its `type` param is assignment-compatible with the deps signature
  // (BackgroundTask['type'] is a string-literal union local to this file, so we widen it
  // here and cast back inside the wrapper — the only legal value the wrapper ever sees is
  // 'whisper-asr', which is part of the union).
  bgTaskStart: (type, label, detail) => bgTaskStart(type as BackgroundTask['type'], label, detail),
  bgTaskUpdate,
  bgTaskDone,
  bgTaskError,
});

app.get('/api/backend/assets/videos/whisper/health', async (_req, res) => {
  res.json(await whisperJobs.health());
});

app.get('/api/backend/assets/videos/whisper/jobs', (_req, res) => {
  res.json({ jobs: whisperJobs.getAll() });
});

app.get('/api/backend/assets/videos/whisper/status', (req, res) => {
  const p = String(req.query.path ?? '');
  if (!p) { res.status(400).json({ error: 'path query parameter required' }); return; }
  res.json({ job: whisperJobs.get(p) });
});

app.get('/api/backend/assets/videos/whisper/transcript', async (req, res) => {
  const p = String(req.query.path ?? '');
  if (!p) { res.status(400).json({ error: 'path query parameter required' }); return; }
  const data = await whisperJobs.readTranscript(p);
  if (data === null) { res.status(404).json({ error: 'No transcript for this video' }); return; }
  res.json(data);
});

app.post('/api/backend/assets/videos/whisper/start', async (req, res) => {
  try {
    const p = String(req.body?.path ?? '');
    const lang = String(req.body?.language ?? 'en') as WhisperLanguage;
    if (!p) { res.status(400).json({ error: 'path required' }); return; }
    if (lang !== 'en' && lang !== 'de') { res.status(400).json({ error: 'language must be en or de' }); return; }
    const health = await whisperJobs.health();
    if (!health.ok) { res.status(503).json({ error: health.reason }); return; }
    const job = await whisperJobs.start(p, lang);
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

for (const action of ['pause', 'resume', 'stop'] as const) {
  app.post(`/api/backend/assets/videos/whisper/${action}`, async (req, res) => {
    try {
      const p = String(req.body?.path ?? '');
      if (!p) { res.status(400).json({ error: 'path required' }); return; }
      const job = await whisperJobs[action](p);
      res.json({ job });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}

// ── Spellcheck ("Lektorat") — German spelling + grammar via LanguageTool ──
// See specs/spellcheck.md. The config + allowlist live in repo-root spellcheck-allowlist.json
// (re-read every request, never cached). The feature is globally off by default.

function spellErrorStatus(err: LanguageToolError): number {
  return err.kind === 'rate_limited' ? 503 : 502;
}

app.get('/api/backend/spellcheck/health', async (_req, res) => {
  const health = await checkLanguageToolHealth();
  res.status(health.ok ? 200 : 503).json(health);
});

// Live rate-limiter status — the scan UI polls this to show a "waiting on rate limit" banner.
app.get('/api/backend/spellcheck/rate-status', (_req, res) => {
  res.json(getRateLimitStatus());
});

// Admin-managed local LanguageTool Docker container (see server/languagetool-docker.ts).
app.get('/api/backend/spellcheck/docker/status', async (_req, res) => {
  res.json(await getLtDockerStatus());
});

app.post('/api/backend/spellcheck/docker/start', async (_req, res) => {
  void startLtDocker(); // non-blocking: the UI polls /status until the phase settles
  res.json(await getLtDockerStatus());
});

app.post('/api/backend/spellcheck/docker/stop', async (_req, res) => {
  await stopLtDocker();
  res.json(await getLtDockerStatus());
});

app.post('/api/backend/spellcheck/docker/cancel', async (_req, res) => {
  await cancelLtDocker();
  res.json(await getLtDockerStatus());
});

app.get('/api/backend/spellcheck/allowlist', async (_req, res) => {
  res.json(await readSpellConfig());
});

app.post('/api/backend/spellcheck/set-enabled', async (req, res) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled must be a boolean' }); return; }
  try {
    res.json(await setSpellEnabled(enabled));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/backend/spellcheck/set-skip-names', async (req, res) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled must be a boolean' }); return; }
  try {
    res.json(await setSpellSkipNames(enabled));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/backend/spellcheck/allow-word', async (req, res) => {
  const word = typeof req.body?.word === 'string' ? req.body.word.trim() : '';
  if (!word) { res.status(400).json({ error: 'word required' }); return; }
  try { res.json(await addSpellWord(word)); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/backend/spellcheck/remove-word', async (req, res) => {
  const word = typeof req.body?.word === 'string' ? req.body.word : '';
  if (!word) { res.status(400).json({ error: 'word required' }); return; }
  try { res.json(await removeSpellWord(word)); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/backend/spellcheck/ignore-match', async (req, res) => {
  const fingerprint = typeof req.body?.fingerprint === 'string' ? req.body.fingerprint.trim() : '';
  if (!fingerprint) { res.status(400).json({ error: 'fingerprint required' }); return; }
  try { res.json(await addSpellIgnore(fingerprint)); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/backend/spellcheck/remove-ignore', async (req, res) => {
  const fingerprint = typeof req.body?.fingerprint === 'string' ? req.body.fingerprint : '';
  if (!fingerprint) { res.status(400).json({ error: 'fingerprint required' }); return; }
  try { res.json(await removeSpellIgnore(fingerprint)); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/backend/spellcheck/check', async (req, res) => {
  const raw = req.body?.segments;
  if (!Array.isArray(raw)) { res.status(400).json({ error: 'segments must be an array' }); return; }
  if (raw.length > 2000) { res.status(400).json({ error: 'too_many_segments' }); return; }
  const segments: SpellSegmentInput[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const s of raw) {
    const key = typeof s?.key === 'string' ? s.key : '';
    const text = typeof s?.text === 'string' ? s.text : '';
    if (!key) { res.status(400).json({ error: 'each segment needs a non-empty key' }); return; }
    if (seen.has(key)) { res.status(400).json({ error: 'duplicate_key' }); return; }
    seen.add(key);
    totalBytes += Buffer.byteLength(text, 'utf8');
    segments.push({ key, text });
  }
  if (totalBytes > 2_000_000) { res.status(400).json({ error: 'too_large' }); return; }
  try {
    const config = await readSpellConfig();
    const results = await checkSegments(segments, config);
    res.json({ results });
  } catch (err) {
    if (err instanceof LanguageToolError) {
      res.status(spellErrorStatus(err)).json({ error: err.kind, message: err.message });
    } else {
      res.status(500).json({ error: (err as Error).message });
    }
  }
});

// ── SPA fallback ──

if (existsSync(clientDist)) {
  app.get('/*splat', (req, res) => {
    const p = req.path;
    // If the request looks like a file (has an extension on its last
    // segment), it's a missing asset — return 404 rather than the SPA
    // shell. Otherwise the browser receives `text/html` for a hashed JS
    // chunk after a rebuild and the lazy import dies with a MIME-type
    // error instead of a clean network failure. See
    // specs/chunk-load-recovery.md.
    const lastSegment = p.substring(p.lastIndexOf('/') + 1);
    if (/\.[a-zA-Z0-9]+$/.test(lastSegment)) {
      return res.status(404).end();
    }
    if (p.startsWith('/admin')) {
      return res.sendFile(path.join(clientDist, 'admin', 'index.html'));
    }
    if (p.startsWith('/gamemaster')) {
      return res.sendFile(path.join(clientDist, 'gamemaster', 'index.html'));
    }
    if (p.startsWith('/show')) {
      return res.sendFile(path.join(clientDist, 'show', 'index.html'));
    }
    // Anything else (including `/` and legacy routes like `/rules`, `/game`)
    // redirects into the frontend PWA at `/show`. Keeping `/show` disjoint
    // from the other PWA scopes is required so Chrome treats all three as
    // independently installable apps.
    const target = p === '/' ? '/show/' : `/show${p}`;
    res.redirect(302, target);
  });
}

// ── Start ──

// Heavy NAS-walking startup maintenance, deferred past first paint and run SEQUENTIALLY to keep
// peak libuv fs-threadpool concurrency low — otherwise page-serving sendFile()/config reads get
// starved behind slow network-NAS stat/readdir calls on boot. Each step is guarded + timed so a
// slow phase is visible in the logs. See specs/server-startup.md.
const STARTUP_MAINTENANCE_DELAY_MS = 5_000;

async function runStartupMaintenance(): Promise<void> {
  const step = async (label: string, fn: () => Promise<void>): Promise<void> => {
    const t0 = Date.now();
    try {
      await fn();
    } catch (err) {
      console.warn(`[startup-maint] ${label} failed: ${(err as Error).message}`);
    } finally {
      console.log(`[startup-maint] ${label} done in ${Date.now() - t0}ms`);
    }
  };
  // Clean up stale .transcoding.* temp files from interrupted transcodes (local + NAS videos).
  await step('cleanup-transcode-temp', () => cleanupStaleTranscodeFiles());
  // Discard local trash batches older than 24h — the `lastDeletion` undo handle is lost on restart.
  await step('purge-local-trash', () => purgeStaleTrash());
  // Same TTL sweep on the NAS-side `.trash/` mirror created by the symmetric-trash flow.
  await step('purge-nas-trash', () => purgeStaleNasTrash());
  // One-shot backfill: promote legacy YouTube thumbnails into the canonical Audio-Covers/ root. Idempotent.
  await step('backfill-yt-covers', () => backfillYoutubeAudioCovers());
  // Bidirectional NAS sync (the heaviest walk). Re-populate cache sets after it may pull new caches.
  await step('startup-sync', async () => {
    await startupSync();
    await syncCacheFromNas();
    populateCacheSets();
  });
}

const httpServer = app.listen(PORT, async () => {
  // Warm the public-IP cache in the background so the System tab can show it
  // immediately on first open (best-effort — no-op when offline).
  getPublicIpCached();
  // Materialize a real config.json on disk when it's missing or git-crypt
  // encrypted, so the admin config editor and other direct readers work — not
  // just the in-memory fallback. See specs/clean-install.md.
  try {
    const ensured = await ensureConfigFile(CONFIG_PATH);
    if (ensured.action === 'created-missing') {
      console.log('config.json not found — wrote a minimal default config (empty "Beispiele" gameshow). Create example games in the admin "Spiele" tab or via `npm run fixtures`.');
    } else if (ensured.action === 'created-encrypted') {
      const backup = ensured.backupPath ? path.basename(ensured.backupPath) : 'config.json.git-crypt.bak';
      console.log(`config.json was git-crypt encrypted — wrote a minimal default config (original blob preserved as ${backup}). To restore: unlock git-crypt and run \`git checkout config.json\`.`);
    }
  } catch (err) {
    console.warn('Failed to ensure config.json on startup:', err);
  }
  try {
    const config = await loadConfig();
    const gameOrder = getActiveGameOrder(config);
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Active gameshow: "${config.activeGameshow}" with ${gameOrder.length} games`);
  } catch (err) {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.warn('Failed to load config on startup:', err);
  }
  // Ensure a background-music subfolder exists for every theme so the DAM exposes each as a drop target.
  for (const t of VALID_THEMES) {
    try { await mkdir(path.join(LOCAL_ASSETS_BASE, 'background-music', t), { recursive: true }); }
    catch { /* ignore — best-effort */ }
  }
  // Populate in-memory cache sets from local disk (fast, local read).
  populateCacheSets();
  // Route an already-running local LanguageTool container BEFORE the heavy NAS maintenance below.
  // Detection is sub-second on a warm Docker daemon, so the spellchecker is routed at the fast
  // local instance up front instead of behind minutes of NAS I/O. See specs/server-startup.md.
  detectLtDockerOnStartup().catch(err => console.warn(`[language-tool] startup detect failed: ${(err as Error).message}`));
  // Whisper jobs reconciliation: detect detached children that survived a Node restart, reattach
  // progress watchers, mark dead PIDs as `interrupted`. Light (PID check + local state). Idempotent.
  whisperJobs.reconcile().catch(err => console.warn(`[whisper-jobs] reconcile failed: ${(err as Error).message}`));
  // Heavy NAS-walking maintenance (transcode-temp cleanup, trash sweeps, YT-cover backfill,
  // bidirectional sync) is DEFERRED past first paint and run SEQUENTIALLY. Firing them all at once
  // here put 6–8 slow network-NAS stat/readdir calls in flight simultaneously, saturating libuv's
  // fs threadpool — and sendFile() (the SPA shell) + config reads queue behind that same pool, so
  // the first page load hung for minutes. See specs/server-startup.md.
  setTimeout(() => {
    runStartupMaintenance().catch(err => console.error('[startup-maint] Unhandled error:', err));
  }, STARTUP_MAINTENANCE_DELAY_MS);
  // Prune obsolete segment/track caches 30 s after boot — by then the startup NAS sync has
  // had a chance to pull in any caches the other machine may have created, and HDR probes
  // have populated hdrCache. Delaying keeps server boot snappy.
  setTimeout(() => {
    pruneUnusedCaches().catch(err => console.warn(`[cache] Startup prune failed: ${(err as Error).message}`));
  }, 30_000);
});

// Persist whisper job state on graceful shutdown so a restart can reattach. We do NOT kill
// detached whisper children — the whole point of the detached spawn is that they keep running
// across Node restarts. The next start picks them back up via PID liveness check.
function flushAndExit(code: number = 0): void {
  try { whisperJobs.flushSync(); } catch { /* ignore */ }
  process.exit(code);
}
process.on('SIGTERM', () => flushAndExit(0));
process.on('SIGINT', () => flushAndExit(130));

// ── WebSocket push server ──
setupWebSocket(httpServer, {
  getYtDownloadStatus: () => ({ jobs: Array.from(ytDownloadJobs.values()) }),
  getAudioCoverStatus: () => ({ jobs: Array.from(audioCoverJobs.values()) }),
  buildSystemStatus: buildSystemStatusPayload,
  getAssetStorage: () => ({ mode: 'local', path: LOCAL_ASSETS_BASE, nasMounted: isNasMounted() }),
});

// ── Live content reload ──
// Watch config.json / theme-settings.json / games/*.json and push a
// `content-changed` event so the frontend re-fetches without a page reload.
// See specs/live-config-reload.md.
startContentWatch(ROOT_DIR, GAMES_DIR);
