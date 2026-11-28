/**
 * Film stripes for the `film-stripe` game type ("Filmstreifen").
 *
 * A stripe is a whole film reduced to FILM_STRIPE_COLUMNS colours: the film is
 * sampled at evenly spaced moments and each sampled frame becomes its average
 * colour. Every FILM_STRIPE_FRAME_EVERY-th sampled frame is also kept as a small
 * JPEG; played in order they are the time-lapse the game shows as a hint.
 *
 * Computing a stripe means hundreds of seeks into a file that is often two hours
 * long and may sit on the NAS, so it is ALWAYS precomputed (admin "Streifen
 * berechnen", or the example-game fixtures) and the show only ever reads the cache:
 *
 *   <videoCacheBase>/film-stripe/<slug>/stripe.json   colours + bookkeeping
 *   <videoCacheBase>/film-stripe/<slug>/frame-NN.jpg  time-lapse stills
 *
 * The cache is local-only, like the random-frame cache. This module does no NAS
 * I/O of its own: the caller resolves the source path and stats it through the
 * bounded helpers in nas-reachability.ts. See specs/games/film-stripe.md.
 */
import { spawn } from 'child_process';
import type { ChildProcess, SpawnOptions } from 'child_process';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

/** Bump when the sampling or the file layout changes; older caches read as absent. */
export const FILM_STRIPE_VERSION = 1;
export const FILM_STRIPE_COLUMNS = 240;
/** Every n-th sampled frame is kept as a time-lapse still (240 / 5 = 48 stills). */
export const FILM_STRIPE_FRAME_EVERY = 5;
export const FILM_STRIPE_FRAME_WIDTH = 640;
/** The sampled window, as fractions of the runtime: skips studio logos and most of the credits. */
export const FILM_STRIPE_START_FRAC = 0.03;
export const FILM_STRIPE_END_FRAC = 0.93;
/** A single seek that takes longer than this is killed — a stale NAS mount must not hang the job. */
export const FILM_STRIPE_FRAME_TIMEOUT_MS = 45_000;
const PARALLEL_SEEKS = 3;
/** More failed frames than this share and the stripe is not worth keeping. */
const MAX_FAILED_SHARE = 0.3;

export interface FilmStripeSource {
  mtimeMs: number;
  size: number;
}

export interface FilmStripeManifest {
  version: number;
  /** One `#rrggbb` per sampled moment, in film order. */
  colors: string[];
  /** Number of `frame-NN.jpg` stills on disk. */
  frames: number;
  /** For each still, the index of its moment in `colors`. */
  framePositions: number[];
  /** The source file the stripe was computed from — compared to detect a replaced video. */
  source: FilmStripeSource;
  /** Sampled window in seconds. */
  start: number;
  end: number;
  createdAt: string;
}

/** What the show needs per question; attached to the game response by the server. */
export interface FilmStripeData {
  colors: string[];
  frames: number;
  framePositions: number[];
}

/**
 * Flat, file-system-safe name of a video's cache directory, from its path relative
 * to the videos root. NFD-normalised first, so the name is the same whether the
 * path came from the macOS file system (always NFD) or from a game file (NFC) —
 * the same rule as the server's `cacheSlug`, minus the extension.
 */
export function filmStripeSlug(relPath: string): string {
  return relPath
    .normalize('NFD')
    .replace(/[/\\]/g, '__')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.[^.]+$/, '');
}

export function filmStripeBaseDir(videoCacheBase: string): string {
  return path.join(videoCacheBase, 'film-stripe');
}

/** Directory holding the stripe of the video at `relPath` (relative to the videos root). */
export function filmStripeDir(videoCacheBase: string, relPath: string): string {
  return path.join(filmStripeBaseDir(videoCacheBase), filmStripeSlug(relPath));
}

export function filmStripeFrameName(index: number): string {
  return `frame-${String(index).padStart(2, '0')}.jpg`;
}

/** Midpoints of `columns` equal slices of [start, end] — no sample sits on either edge. */
export function sampleTimestamps(start: number, end: number, columns: number = FILM_STRIPE_COLUMNS): number[] {
  const span = Math.max(0, end - start);
  return Array.from({ length: columns }, (_, i) => start + (span * (i + 0.5)) / columns);
}

/** The sampled window for a film of `duration` seconds. */
export function filmStripeWindow(duration: number): { start: number; end: number } {
  return { start: duration * FILM_STRIPE_START_FRAC, end: duration * FILM_STRIPE_END_FRAC };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Average colour of an encoded image. */
export async function meanColor(image: Buffer): Promise<string> {
  const { channels } = await sharp(image).removeAlpha().toColourspace('srgb').stats();
  const [r, g, b] = channels;
  // A greyscale source decodes to one channel.
  if (r && (!g || !b)) return rgbToHex(r.mean, r.mean, r.mean);
  return rgbToHex(r?.mean ?? 0, g?.mean ?? 0, b?.mean ?? 0);
}

function isManifest(value: unknown): value is FilmStripeManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return m.version === FILM_STRIPE_VERSION
    && Array.isArray(m.colors) && m.colors.length > 0
    && (m.colors as unknown[]).every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
    && typeof m.frames === 'number' && m.frames >= 0
    && Array.isArray(m.framePositions) && m.framePositions.length === m.frames
    && typeof m.source === 'object' && m.source !== null;
}

/** The cached stripe of a video, or null when none (or an outdated/corrupt one) is on disk. */
export async function readFilmStripe(dir: string): Promise<FilmStripeManifest | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(dir, 'stripe.json'), 'utf8'));
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The part of a manifest the show gets. */
export function toFilmStripeData(manifest: FilmStripeManifest): FilmStripeData {
  return { colors: manifest.colors, frames: manifest.frames, framePositions: manifest.framePositions };
}

/**
 * Add the cached stripe to every question of a film-stripe game. Cache only: a
 * film whose stripe was never computed (or whose path is not a plain path under
 * `/videos/`) is returned as it is, and the show says that the stripe is missing.
 */
export async function attachFilmStripes<T extends { video: string }>(
  questions: readonly T[],
  videoCacheBase: string,
  isSafePath: (relPath: string) => boolean,
): Promise<(T & { stripe?: FilmStripeData })[]> {
  return Promise.all(questions.map(async q => {
    const relPath = typeof q.video === 'string' ? q.video.replace(/^\/+videos\/+/, '') : '';
    if (!relPath || !isSafePath(relPath)) return q;
    const manifest = await readFilmStripe(filmStripeDir(videoCacheBase, relPath));
    return manifest ? { ...q, stripe: toFilmStripeData(manifest) } : q;
  }));
}

/**
 * Was the stripe computed from the file that is there now? `source === null` means
 * the file cannot be stat'ed (NAS unmounted): nothing says the stripe is outdated,
 * and it is the only copy there is, so it counts as current.
 */
export function isFilmStripeCurrent(manifest: FilmStripeManifest, source: FilmStripeSource | null): boolean {
  if (!source) return true;
  return manifest.source.size === source.size && Math.abs(manifest.source.mtimeMs - source.mtimeMs) < 2000;
}

export type FrameExtractor = (seconds: number) => Promise<Buffer>;

export interface FrameExtractorOptions {
  ffmpegBin: string;
  sourcePath: string;
  /** Video filters applied after the scale — the HDR→SDR tone map for an HDR source.
   *  After, not before: tone-mapping a 4K frame in float costs seconds per frame,
   *  the same on the 640 px frame a fraction of that, and the average colour is the
   *  same either way. */
  toneMapFilter?: string;
  width?: number;
  timeoutMs?: number;
  /** How ffmpeg is spawned. The server passes its low-priority background spawner. */
  spawnFfmpeg?: (args: string[], options: SpawnOptions) => ChildProcess;
}

/**
 * One seek + one decoded frame, as a JPEG no wider than `width`.
 *
 * The process always has an `'error'` listener and is killed after `timeoutMs`:
 * an unhandled `'error'` event takes the server down (specs/crash-recovery.md), and
 * a read from a stale network mount never returns on its own.
 */
export function createFrameExtractor(options: FrameExtractorOptions): FrameExtractor {
  const width = options.width ?? FILM_STRIPE_FRAME_WIDTH;
  const timeoutMs = options.timeoutMs ?? FILM_STRIPE_FRAME_TIMEOUT_MS;
  const spawnFfmpeg = options.spawnFfmpeg ?? ((args, opts) => spawn(options.ffmpegBin, args, opts));
  const filters = [`scale='min(${width},iw)':-2`, options.toneMapFilter].filter(Boolean).join(',');

  return (seconds: number) => new Promise<Buffer>((resolve, reject) => {
    const proc = spawnFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      // Take the keyframe at or before the timestamp instead of decoding forward to
      // the exact frame. A stripe does not care which frame of a second it gets, and
      // on a 4K HEVC file the frames in between are most of the work.
      '-noaccurate_seek',
      '-ss', seconds.toFixed(3), '-i', options.sourcePath,
      '-frames:v', '1', '-an', '-sn',
      '-vf', filters,
      '-q:v', '4', '-f', 'image2', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (err: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      finish(new Error(`ffmpeg frame extract timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('error', err => finish(err));
    proc.on('close', code => {
      if (code === 0 && chunks.length > 0) finish(null);
      else finish(new Error(`ffmpeg frame extract exited ${code}`));
    });
  });
}

export interface BuildFilmStripeOptions {
  /** Target directory (`filmStripeDir`). Replaced as a whole when the build succeeds. */
  dir: string;
  source: FilmStripeSource;
  /** Runtime of the film in seconds. */
  duration: number;
  extractFrame: FrameExtractor;
  onProgress?: (done: number, total: number) => void;
  columns?: number;
  frameEvery?: number;
}

/**
 * Sample the film, write stills + manifest into a temporary directory and swap it
 * in. A failed build leaves the previous stripe untouched.
 *
 * A frame that cannot be extracted (a damaged stretch of the file) takes the colour
 * of the frame before it; the build only fails when too many are missing.
 */
export async function buildFilmStripe(options: BuildFilmStripeOptions): Promise<FilmStripeManifest> {
  const columns = options.columns ?? FILM_STRIPE_COLUMNS;
  const frameEvery = options.frameEvery ?? FILM_STRIPE_FRAME_EVERY;
  if (!(options.duration > 0)) throw new Error('Dauer des Videos unbekannt');

  const { start, end } = filmStripeWindow(options.duration);
  const timestamps = sampleTimestamps(start, end, columns);
  const tmpPrefix = `${path.basename(options.dir)}.tmp-`;
  // A build that was cut off (server restart, crash) leaves its temporary directory
  // behind. Only one build per video runs at a time, so any that exist are stale.
  const parent = path.dirname(options.dir);
  for (const entry of await readdir(parent).catch(() => [] as string[])) {
    if (entry.startsWith(tmpPrefix)) await rm(path.join(parent, entry), { recursive: true, force: true });
  }
  const tmpDir = path.join(parent, `${tmpPrefix}${process.pid}-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const colors: (string | null)[] = new Array<string | null>(columns).fill(null);
    const stills = new Map<number, Buffer>();
    let done = 0;
    let failed = 0;
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < columns) {
        const i = next++;
        try {
          const frame = await options.extractFrame(timestamps[i]!);
          colors[i] = await meanColor(frame);
          if (i % frameEvery === 0) stills.set(i, frame);
        } catch {
          failed++;
        }
        done++;
        options.onProgress?.(done, columns);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_SEEKS, columns) }, () => worker()));

    if (failed > columns * MAX_FAILED_SHARE) {
      throw new Error(`${failed} von ${columns} Bildern nicht lesbar`);
    }

    // Fill gaps from the left neighbour (or the first readable frame).
    const firstKnown = colors.find((c): c is string => c !== null) ?? '#000000';
    let previous = firstKnown;
    const filled = colors.map(c => {
      if (c !== null) previous = c;
      return c ?? previous;
    });

    const framePositions = [...stills.keys()].sort((a, b) => a - b);
    for (let n = 0; n < framePositions.length; n++) {
      await writeFile(path.join(tmpDir, filmStripeFrameName(n)), stills.get(framePositions[n]!)!);
    }

    const manifest: FilmStripeManifest = {
      version: FILM_STRIPE_VERSION,
      colors: filled,
      frames: framePositions.length,
      framePositions,
      source: options.source,
      start,
      end,
      createdAt: new Date().toISOString(),
    };
    await writeFile(path.join(tmpDir, 'stripe.json'), JSON.stringify(manifest) + '\n');

    await rm(options.dir, { recursive: true, force: true });
    await mkdir(path.dirname(options.dir), { recursive: true });
    await rename(tmpDir, options.dir);
    return manifest;
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}
