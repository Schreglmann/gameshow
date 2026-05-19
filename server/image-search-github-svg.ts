/**
 * Image search provider that surfaces SVG logos indexed from public GitHub
 * repos (gilbarbara/logos, detain/svg-logos, simple-icons). The manifests are
 * loaded once at server startup by `loadManifests`; this file is only the thin
 * adapter from `SvgManifestHit` to the orchestrator's `RawImageSearchResult`
 * shape.
 *
 * Returns SVG URLs pointing at `raw.githubusercontent.com`. `fetchImageBytesFromUrl`
 * already sniffs SVG by Content-Type + `<svg>` / `<?xml>` magic bytes, so the
 * downstream download path needs no changes.
 */

import { searchManifests } from './svg-manifest.js';
import type { RawImageSearchResult } from './image-search-types.js';

export async function searchGithubSvg(
  query: string,
  limit: number,
  signal?: AbortSignal,
  offset = 0,
): Promise<RawImageSearchResult[]> {
  signal?.throwIfAborted();
  const hits = searchManifests(query, limit, offset);
  return hits.map(hit => ({
    url: hit.url,
    thumbnailUrl: hit.url,
    source: 'github-svg' as const,
    title: hit.name.replace(/\.svg$/i, ''),
  }));
}
