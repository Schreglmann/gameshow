// YouTube keyword-search orchestrator. Mirrors server/image-search.ts: runs a
// flat (metadata-only, no download) yt-dlp search, normalises the NDJSON output,
// and caches each `(query, limit, page)` tuple for 1 hour in memory. The actual
// download is performed later by the existing `youtube-download` route once the
// user picks a result.
//
// `yt-dlp "ytsearchN:<query>" --flat-playlist --dump-json` prints one JSON
// object per result in a single fast request — no per-video extraction.

import { spawn } from 'child_process';
import { YT_DLP_BIN, ensureYtDlp } from './yt-dlp.js';

export interface YouTubeSearchResult {
  id: string;
  url: string;          // canonical watch URL — fed to the youtube-download route
  title: string;
  channel?: string;
  duration?: number;    // seconds
  viewCount?: number;
  thumbnailUrl?: string;
}

export interface YouTubeSearchResponse {
  results: YouTubeSearchResult[];
  page: number;
  hasMore: boolean;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_ENTRIES = 200;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const MAX_TOTAL = 100; // never ask yt-dlp for more than this many search hits at once

const cache = new Map<string, { value: YouTubeSearchResponse; ts: number }>();

function cacheKey(query: string, limit: number, page: number): string {
  return `${limit}|${page}|${query.trim().toLowerCase()}`;
}

/** Pick a reasonably-sized thumbnail (~320px wide) from a flat-playlist entry,
 *  falling back to YouTube's deterministic hqdefault URL keyed by video id. */
function pickThumbnail(entry: Record<string, unknown>, id: string): string | undefined {
  const thumbs = entry.thumbnails;
  if (Array.isArray(thumbs) && thumbs.length > 0) {
    const withUrl = thumbs.filter(
      (t): t is { url: string; width?: number } =>
        !!t && typeof (t as { url?: unknown }).url === 'string',
    );
    if (withUrl.length > 0) {
      // Prefer the smallest thumbnail at least 240px wide; otherwise the largest.
      const sorted = [...withUrl].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
      const mid = sorted.find(t => (t.width ?? 0) >= 240);
      return (mid ?? sorted[sorted.length - 1]).url;
    }
  }
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined;
}

/** Parse yt-dlp `--dump-json --flat-playlist` NDJSON into normalised results.
 *  Pure + side-effect-free so it can be unit-tested without spawning a process. */
export function parseYtSearchOutput(stdout: string): YouTubeSearchResult[] {
  const out: YouTubeSearchResult[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue; // skip non-JSON noise lines
    }
    const id = typeof entry.id === 'string' ? entry.id : '';
    if (!id) continue;
    // Skip channels and playlists — a `ytsearch` returns those mixed in with
    // videos. They have no duration (which is why they appeared "without a
    // length") and can't be downloaded. Real videos carry ie_key 'Youtube' and
    // an 11-char id; channels/playlists use ie_key 'YoutubeTab' and longer ids.
    const ieKey = typeof entry.ie_key === 'string' ? entry.ie_key : '';
    const isVideo = ieKey ? ieKey === 'Youtube' : /^[A-Za-z0-9_-]{11}$/.test(id);
    if (!isVideo) continue;
    const title = typeof entry.title === 'string' && entry.title ? entry.title : id;
    const channel =
      typeof entry.channel === 'string'
        ? entry.channel
        : typeof entry.uploader === 'string'
          ? entry.uploader
          : undefined;
    const duration = typeof entry.duration === 'number' ? entry.duration : undefined;
    const viewCount = typeof entry.view_count === 'number' ? entry.view_count : undefined;
    out.push({
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title,
      ...(channel ? { channel } : {}),
      ...(duration != null ? { duration } : {}),
      ...(viewCount != null ? { viewCount } : {}),
      thumbnailUrl: pickThumbnail(entry, id),
    });
  }
  return out;
}

// The runner is injectable so tests can supply canned yt-dlp output without
// spawning a process.
export type YtSearchRunner = (query: string, count: number, signal?: AbortSignal) => Promise<string>;

const defaultRunner: YtSearchRunner = async (query, count, signal) => {
  await ensureYtDlp();
  // No --js-runtimes here: a flat (metadata-only) search never executes the
  // YouTube player JS, so probing/launching a JS runtime would only add startup
  // latency. `--flat-playlist` keeps it to a single request with no per-video
  // resolution.
  const args = [
    `ytsearch${count}:${query}`,
    '--flat-playlist',
    '--dump-json',
    '--no-warnings',
    '--ignore-errors',
  ];
  return await new Promise<string>((resolve, reject) => {
    const proc = spawn(YT_DLP_BIN, args, { signal });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      // yt-dlp exits non-zero on partial failures even with --ignore-errors;
      // accept any output we got, only reject when there is none.
      if (stdout.trim()) resolve(stdout);
      else if (code === 0) resolve('');
      else reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
    });
  });
};

export async function searchYouTube(
  opts: { query: string; limit?: number; page?: number; signal?: AbortSignal },
  runner: YtSearchRunner = defaultRunner,
): Promise<YouTubeSearchResponse> {
  const query = opts.query.trim();
  if (!query) throw new Error('Empty query');
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(opts.page ?? 1, 1);
  const total = Math.min(limit * page, MAX_TOTAL);

  const key = cacheKey(query, limit, page);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;

  const stdout = await runner(query, total, opts.signal);
  // Count raw entries (videos + channels + playlists) before the video filter:
  // exhaustion is a property of the search, not of our filter, so `hasMore` is
  // based on this rather than the filtered video count.
  const rawCount = stdout.split('\n').filter(l => l.trim().startsWith('{')).length;
  // Return the cumulative video list for this batch. The client dedupes by URL
  // when appending on "Mehr laden", so growing the batch adds only the new
  // videos — and never drops one to index drift from filtered-out channels.
  const results = parseYtSearchOutput(stdout);
  // A full raw batch (yt-dlp returned everything we asked for) means YouTube has
  // more; stop once we hit the hard cap.
  const hasMore = rawCount >= total && total < MAX_TOTAL;

  const response: YouTubeSearchResponse = { results, page, hasMore };

  // Bounded LRU-ish: drop the oldest entry when the cap is reached.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]?.[0];
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value: response, ts: Date.now() });
  return response;
}

// Test hook — drop all cached entries.
export function clearYoutubeSearchCache(): void {
  cache.clear();
}
