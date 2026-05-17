import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { searchImages, clearImageSearchCache } from '../../../server/image-search.js';

// The orchestrator depends on the three provider modules; they each call
// `fetch()`. We stub global fetch with response queues per provider key so
// every test controls exactly what each provider returns.

interface QueueEntry { ok: boolean; status: number; body: unknown }
let routes: Map<RegExp, QueueEntry[]>;

function queueResponse(matcher: RegExp, entry: QueueEntry): void {
  const existing = routes.get(matcher) || [];
  existing.push(entry);
  routes.set(matcher, existing);
}

function findRoute(url: string): QueueEntry | undefined {
  for (const [pat, entries] of routes.entries()) {
    if (pat.test(url) && entries.length > 0) return entries.shift();
  }
  return undefined;
}

beforeEach(() => {
  routes = new Map();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const match = findRoute(url);
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    if (!match.ok) {
      return { ok: false, status: match.status, statusText: 'err',
        text: async () => '', json: async () => ({}),
        arrayBuffer: async () => new ArrayBuffer(0), headers: new Headers() } as Response;
    }
    const isJson = typeof match.body !== 'string';
    return {
      ok: true,
      status: 200,
      text: async () => (typeof match.body === 'string' ? match.body : JSON.stringify(match.body)),
      json: async () => (isJson ? match.body : JSON.parse(match.body as string)),
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: new Headers({ 'content-type': isJson ? 'application/json' : 'text/html' }),
    } as Response;
  }));
  clearImageSearchCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearImageSearchCache();
});

describe('searchImages orchestrator', () => {
  it('merges and dedupes results across providers, sorts by pixel area', async () => {
    // DDG: token HTML then i.js JSON. Includes a `dupe.example` entry that
    // Commons also returns to verify URL-based deduplication.
    queueResponse(/duckduckgo\.com\/\?q=/, { ok: true, status: 200, body: 'vqd="3-abc-token-xyz"' });
    queueResponse(/duckduckgo\.com\/i\.js/, { ok: true, status: 200, body: {
      results: [
        { image: 'https://a.example/1.jpg', thumbnail: 'https://a/t1.jpg', width: 800, height: 600 },
        { image: 'https://dupe.example/x.jpg', width: 1920, height: 1080 },
        { image: 'https://b.example/2.jpg', width: 400, height: 300 },
      ],
    } });
    // Commons: search then imageinfo (the largest result + a duplicate of DDG's `dupe.example`)
    queueResponse(/commons\.wikimedia\.org\/w\/api\.php\?action=query&list=search/, { ok: true, status: 200, body: {
      query: { search: [{ title: 'File:Foo.jpg' }, { title: 'File:Dupe.jpg' }] },
    } });
    queueResponse(/commons\.wikimedia\.org\/w\/api\.php\?action=query&prop=imageinfo/, { ok: true, status: 200, body: {
      query: { pages: {
        '1': { title: 'File:Foo.jpg', imageinfo: [{
          url: 'https://commons.example/foo.jpg', thumburl: 'https://commons/t.jpg', width: 2000, height: 1500,
          extmetadata: { LicenseShortName: { value: 'CC-BY-SA-4.0' } },
        }] },
        '2': { title: 'File:Dupe.jpg', imageinfo: [{
          url: 'https://dupe.example/x.jpg', width: 1920, height: 1080,
        }] },
      } },
    } });

    const resp = await searchImages({ query: 'matthew mercer', limit: 50 });

    expect(resp.partial).toBe(false);
    // Expect dedupe: dupe.example appears once
    const urls = resp.results.map(r => r.url);
    expect(urls.filter(u => u === 'https://dupe.example/x.jpg').length).toBe(1);
    // Sorted by pixel area: 2000x1500 > 1920x1080 > 800x600 > 400x300
    expect(resp.results[0].width).toBe(2000);
    expect(resp.results[0].height).toBe(1500);
    expect(resp.results[0].source).toBe('commons');
  });

  it('marks partial:true and returns errors when one provider fails', async () => {
    // DDG fails (token not found in HTML)
    queueResponse(/duckduckgo\.com\/\?q=/, { ok: true, status: 200, body: '<html>no token here</html>' });
    // Commons ok with one result
    queueResponse(/commons\.wikimedia\.org\/w\/api\.php\?action=query&list=search/, { ok: true, status: 200, body: { query: { search: [{ title: 'File:A.jpg' }] } } });
    queueResponse(/commons\.wikimedia\.org\/w\/api\.php\?action=query&prop=imageinfo/, { ok: true, status: 200, body: {
      query: { pages: { '1': { title: 'File:A.jpg', imageinfo: [{ url: 'https://c.example/a.jpg', width: 500, height: 500 }] } } },
    } });

    const resp = await searchImages({ query: 'q' });
    expect(resp.partial).toBe(true);
    expect(resp.errors?.ddg).toMatch(/vqd/i);
    expect(resp.results.length).toBe(1);
  });

  it('throws when every provider fails', async () => {
    queueResponse(/duckduckgo\.com\/\?q=/, { ok: false, status: 500, body: '' });
    queueResponse(/commons\.wikimedia\.org/, { ok: false, status: 500, body: '' });
    await expect(searchImages({ query: 'q' })).rejects.toThrow(/All providers failed/);
  });

  it('caches results for the same query+providers tuple', async () => {
    queueResponse(/duckduckgo\.com\/\?q=/, { ok: true, status: 200, body: 'vqd="3-token"' });
    queueResponse(/duckduckgo\.com\/i\.js/, { ok: true, status: 200, body: { results: [{ image: 'https://a/1.jpg', width: 100, height: 100 }] } });
    queueResponse(/commons/, { ok: true, status: 200, body: { query: { search: [] } } });

    const r1 = await searchImages({ query: 'cached query' });
    const r2 = await searchImages({ query: 'cached query' });
    expect(r1).toEqual(r2);
    // First lookup makes ≤3 fetches (DDG html + i.js + Commons search; Commons skips
    // imageinfo on empty results). Second lookup is served from cache.
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    expect(calls).toBeLessThanOrEqual(3);
  });

  it('rejects empty queries', async () => {
    await expect(searchImages({ query: '   ' })).rejects.toThrow();
  });
});
