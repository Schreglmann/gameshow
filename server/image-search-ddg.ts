// DuckDuckGo Images provider — free, no API key.
//
// DDG doesn't publish a public image search API. The unofficial flow used by
// most open-source clients is:
//   1. GET https://duckduckgo.com/?q=<query>&iax=images&ia=images
//      → HTML response containing a `vqd` anti-CSRF token
//   2. GET https://duckduckgo.com/i.js?l=us-en&o=json&q=<query>&vqd=<vqd>
//      → JSON `{ results: [{ image, thumbnail, width, height, title, source }] }`
//
// This is fragile by nature: DDG can change the token format or the i.js path
// at any time. The provider is isolated to this file so a fix is a single-file
// change, and the orchestrator continues to serve results from the other
// providers via the `partial: true` flag if this one fails.

import type { RawImageSearchResult } from './image-search-types.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Patterns the `vqd` token has appeared in over the past few years:
//   vqd="3-12345..."     vqd='3-12345...'     vqd=3-12345...
//   "vqd":"3-12345..."   'vqd':'3-12345...'   vqd:"3-12345..."
const VQD_PATTERNS = [
  /vqd=["']([\w-]+)["']/,
  /["']vqd["']\s*:\s*["']([\w-]+)["']/,
  /vqd=([\w-]+)&/,
];

async function fetchVqd(query: string, signal?: AbortSignal): Promise<string> {
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal });
  if (!res.ok) throw new Error(`DDG token fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  for (const pat of VQD_PATTERNS) {
    const m = html.match(pat);
    if (m && m[1]) return m[1];
  }
  throw new Error('DDG vqd token not found in response — endpoint may have changed');
}

export async function searchDdg(
  query: string,
  limit: number,
  signal?: AbortSignal,
  offset = 0,
): Promise<RawImageSearchResult[]> {
  const vqd = await fetchVqd(query, signal);
  // DDG's `s` query param is the offset; the API returns ~100 items per page.
  const url =
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}` +
    `&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1&s=${offset}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Referer': 'https://duckduckgo.com/',
      'X-Requested-With': 'XMLHttpRequest',
    },
    signal,
  });
  if (!res.ok) throw new Error(`DDG i.js failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{
      image?: string;
      thumbnail?: string;
      width?: number;
      height?: number;
      title?: string;
      source?: string;
    }>;
  };
  const items = data.results ?? [];
  const out: RawImageSearchResult[] = [];
  for (const item of items.slice(0, limit)) {
    if (!item.image) continue;
    out.push({
      url: item.image,
      thumbnailUrl: item.thumbnail,
      width: typeof item.width === 'number' ? item.width : undefined,
      height: typeof item.height === 'number' ? item.height : undefined,
      source: 'ddg',
      title: item.title,
    });
  }
  return out;
}
