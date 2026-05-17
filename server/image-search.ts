// Multi-provider image search orchestrator. Runs DuckDuckGo Images and
// Wikimedia Commons in parallel; normalises, deduplicates by URL, and caches
// each `(query, providers)` tuple for 1 hour in memory. If at least one
// provider succeeds, returns `partial: true` with a per-provider error map;
// if every provider fails, the orchestrator throws and the route maps it to
// a 502.
//
// Ordering: DDG results come first (in DDG's own relevance order), Commons
// results follow. DDG's relevance ranking is consumer-friendly — for queries
// like "How to Train Your Dragon" DDG returns the movie, whereas Commons
// matches "Dragon" against SpaceX capsule photos; sorting purely by pixel
// area used to push those huge irrelevant Commons photos to the top. The
// resolution filter (client-side) handles the small-thumbnail concern.

import { searchDdg } from './image-search-ddg.js';
import { searchCommons } from './image-search-commons.js';
import type { ImageSearchProvider, ImageSearchResponse, RawImageSearchResult } from './image-search-types.js';

const ALL_PROVIDERS: ImageSearchProvider[] = ['ddg', 'commons'];
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_ENTRIES = 200;

type Fetcher = (q: string, limit: number, signal?: AbortSignal, offset?: number) => Promise<RawImageSearchResult[]>;
const FETCHERS: Record<ImageSearchProvider, Fetcher> = {
  ddg: searchDdg,
  commons: searchCommons,
};

const cache = new Map<string, { value: ImageSearchResponse; ts: number }>();

function cacheKey(query: string, limit: number, providers: ImageSearchProvider[], page: number): string {
  return `${[...providers].sort().join(',')}|${limit}|${page}|${query.trim().toLowerCase()}`;
}

export async function searchImages(opts: {
  query: string;
  limit?: number;
  providers?: ImageSearchProvider[];
  page?: number;
  signal?: AbortSignal;
}): Promise<ImageSearchResponse> {
  const query = opts.query.trim();
  if (!query) throw new Error('Empty query');
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const offset = (page - 1) * limit;
  const providers = (opts.providers && opts.providers.length > 0
    ? opts.providers.filter((p): p is ImageSearchProvider => ALL_PROVIDERS.includes(p))
    : ALL_PROVIDERS);
  if (providers.length === 0) throw new Error('No valid providers');

  const key = cacheKey(query, limit, providers, page);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;

  // Run in parallel; collect both successes and errors. Each provider gets the
  // full requested limit so the merged result can be deduplicated and sorted
  // before we cap to `limit`.
  const settled = await Promise.allSettled(
    providers.map(p => FETCHERS[p](query, limit, opts.signal, offset)),
  );

  const errors: Partial<Record<ImageSearchProvider, string>> = {};
  const merged: RawImageSearchResult[] = [];
  let anyProviderFullPage = false;
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    const r = settled[i];
    if (r.status === 'fulfilled') {
      merged.push(...r.value);
      // Heuristic: if any provider returned close to `limit` results, assume
      // there are more pages available.
      if (r.value.length >= Math.min(limit, 25)) anyProviderFullPage = true;
    } else {
      errors[p] = r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
  }

  if (merged.length === 0 && Object.keys(errors).length === providers.length) {
    throw new Error(`All providers failed: ${Object.entries(errors).map(([p, m]) => `${p}: ${m}`).join('; ')}`);
  }

  // Deduplicate by URL (case-insensitive). First occurrence wins, which —
  // because `merged` is iterated in `providers` order (DDG, then Commons) —
  // means a URL returned by both providers keeps DDG's source tag. The only
  // case where we swap is when the first entry has no dimensions and a later
  // entry does, since downstream sort + filter logic needs them.
  const byUrl = new Map<string, RawImageSearchResult>();
  for (const r of merged) {
    const k = r.url.toLowerCase();
    const prev = byUrl.get(k);
    if (!prev) { byUrl.set(k, r); continue; }
    if (!prev.width && r.width) byUrl.set(k, r);
  }
  // No pixel-area sort — we rely on per-provider relevance order + the
  // iteration order in `merged` (DDG first, Commons second).
  const results = Array.from(byUrl.values()).slice(0, limit);

  const response: ImageSearchResponse = {
    results,
    partial: Object.keys(errors).length > 0,
    page,
    hasMore: anyProviderFullPage,
    ...(Object.keys(errors).length > 0 ? { errors: errors as Record<ImageSearchProvider, string> } : {}),
  };

  // Bounded LRU-ish: drop the oldest entry when the cap is reached.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]?.[0];
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value: response, ts: Date.now() });
  return response;
}

// Test hook — drop all cached entries.
export function clearImageSearchCache(): void {
  cache.clear();
}
