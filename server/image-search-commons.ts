// Wikimedia Commons image search — free, official, no API key.
//
// Two-step flow:
//   1. GET /w/api.php?action=query&list=search&srnamespace=6&srsearch=<q>&format=json
//      → list of File: page titles matching the query
//   2. GET /w/api.php?action=query&titles=<pipe-separated>&prop=imageinfo
//        &iiprop=url|size|extmetadata&iiurlwidth=400&format=json
//      → URL, thumbnail URL, width, height, and license metadata per file
//
// Wikimedia asks for a contact User-Agent on automated requests — see
// https://meta.wikimedia.org/wiki/User-Agent_policy. We send a project-specific
// UA string so abuse can be traced back if it ever becomes a problem.

import type { RawImageSearchResult } from './image-search-types.js';

const API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia asks for a contact User-Agent on automated requests
// (https://meta.wikimedia.org/wiki/User-Agent_policy). Keep ASCII-only — Node's
// fetch rejects header values containing characters > 0xFF (an em-dash for
// instance throws "Cannot convert argument to a ByteString").
const UA = 'GameshowDam/1.0 (admin asset replace) Node/fetch';

interface SearchHit { title: string }
interface SearchResponse { query?: { search?: SearchHit[] } }

interface ImageInfo {
  url?: string;
  thumburl?: string;
  width?: number;
  height?: number;
  thumbwidth?: number;
  thumbheight?: number;
  extmetadata?: {
    LicenseShortName?: { value?: string };
    License?: { value?: string };
    Artist?: { value?: string };
  };
}
interface ImageInfoPage {
  title?: string;
  imageinfo?: ImageInfo[];
}
interface ImageInfoResponse {
  query?: { pages?: Record<string, ImageInfoPage> };
}

export async function searchCommons(
  query: string,
  limit: number,
  signal?: AbortSignal,
  offset = 0,
): Promise<RawImageSearchResult[]> {
  // Step 1: search.
  const searchUrl =
    `${API}?action=query&list=search&srnamespace=6` +
    `&srsearch=${encodeURIComponent(query)}` +
    `&srlimit=${Math.min(limit, 50)}&sroffset=${offset}&format=json&origin=*`;
  const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': UA }, signal });
  if (!searchRes.ok) throw new Error(`Commons search failed: HTTP ${searchRes.status}`);
  const searchData = (await searchRes.json()) as SearchResponse;
  const titles = (searchData.query?.search ?? []).map(h => h.title).filter(Boolean);
  if (titles.length === 0) return [];

  // Step 2: imageinfo for each title (one call, pipe-separated).
  const infoUrl =
    `${API}?action=query&prop=imageinfo` +
    `&iiprop=${encodeURIComponent('url|size|extmetadata')}` +
    `&iiurlwidth=400` +
    `&titles=${encodeURIComponent(titles.join('|'))}` +
    `&format=json&origin=*`;
  const infoRes = await fetch(infoUrl, { headers: { 'User-Agent': UA }, signal });
  if (!infoRes.ok) throw new Error(`Commons imageinfo failed: HTTP ${infoRes.status}`);
  const infoData = (await infoRes.json()) as ImageInfoResponse;
  const pages = Object.values(infoData.query?.pages ?? {});
  const out: RawImageSearchResult[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.url) continue;
    const license =
      info.extmetadata?.LicenseShortName?.value ||
      info.extmetadata?.License?.value ||
      undefined;
    out.push({
      url: info.url,
      thumbnailUrl: info.thumburl || undefined,
      width: typeof info.width === 'number' ? info.width : undefined,
      height: typeof info.height === 'number' ? info.height : undefined,
      source: 'commons',
      title: page.title?.replace(/^File:/, ''),
      license,
    });
  }
  return out;
}
