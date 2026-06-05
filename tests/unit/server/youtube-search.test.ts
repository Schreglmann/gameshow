import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseYtSearchOutput,
  searchYouTube,
  clearYoutubeSearchCache,
  type YtSearchRunner,
} from '../../../server/youtube-search.js';

// `searchYouTube` spawns yt-dlp via an injectable runner. Tests pass a fake
// runner that returns canned NDJSON, so nothing is spawned.

// One yt-dlp `--dump-json --flat-playlist` line per entry.
function ndjson(entries: Record<string, unknown>[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}

function entry(i: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `id${i}`,
    ie_key: 'Youtube',
    title: `Video ${i}`,
    channel: `Channel ${i}`,
    duration: 60 + i,
    view_count: 1000 + i,
    thumbnails: [
      { url: `https://t/${i}/small.jpg`, width: 120 },
      { url: `https://t/${i}/mid.jpg`, width: 320 },
    ],
    ...over,
  };
}

beforeEach(() => {
  clearYoutubeSearchCache();
});

describe('parseYtSearchOutput', () => {
  it('normalises NDJSON entries into results', () => {
    const out = parseYtSearchOutput(ndjson([entry(1)]));
    expect(out).toEqual([
      {
        id: 'id1',
        url: 'https://www.youtube.com/watch?v=id1',
        title: 'Video 1',
        channel: 'Channel 1',
        duration: 61,
        viewCount: 1001,
        thumbnailUrl: 'https://t/1/mid.jpg', // smallest >= 240px wide
      },
    ]);
  });

  it('falls back to the hqdefault thumbnail when none are provided', () => {
    const out = parseYtSearchOutput(ndjson([entry(2, { thumbnails: undefined })]));
    expect(out[0].thumbnailUrl).toBe('https://i.ytimg.com/vi/id2/hqdefault.jpg');
  });

  it('uses uploader when channel is missing, and omits absent optional fields', () => {
    const out = parseYtSearchOutput(
      ndjson([{ id: 'x', ie_key: 'Youtube', title: 'T', uploader: 'Up', thumbnails: [] }]),
    );
    expect(out[0].channel).toBe('Up');
    expect(out[0].duration).toBeUndefined();
    expect(out[0].viewCount).toBeUndefined();
  });

  it('filters out channels and playlists (entries with no real video id)', () => {
    const out = parseYtSearchOutput(ndjson([
      entry(1),                                                              // video
      { id: 'UC1234567890123456789012', ie_key: 'YoutubeTab', title: 'A Channel' }, // channel
      { id: 'PLabcdefghijklmnopqrstuvwxyz0123', ie_key: 'YoutubeTab', title: 'A Playlist' }, // playlist
      { id: 'aBcDeF12345', title: 'Video w/o ie_key' },                      // 11-char id, kept
    ]));
    expect(out.map(r => r.id)).toEqual(['id1', 'aBcDeF12345']);
  });

  it('skips blank lines and non-JSON noise, and entries without an id', () => {
    const noisy = [
      'WARNING: something',
      '',
      JSON.stringify(entry(1)),
      '{ not json',
      JSON.stringify({ title: 'no id here' }),
    ].join('\n');
    const out = parseYtSearchOutput(noisy);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('id1');
  });
});

describe('searchYouTube', () => {
  it('rejects an empty query', async () => {
    await expect(searchYouTube({ query: '   ' }, vi.fn())).rejects.toThrow(/Empty query/);
  });

  it('returns the first page of results', async () => {
    const runner: YtSearchRunner = vi.fn(async () =>
      ndjson(Array.from({ length: 24 }, (_, i) => entry(i))),
    );
    const resp = await searchYouTube({ query: 'cats', limit: 24, page: 1 }, runner);
    expect(resp.page).toBe(1);
    expect(resp.results).toHaveLength(24);
    expect(resp.results[0].id).toBe('id0');
  });

  it('requests limit*page cumulatively and returns the whole batch (client dedupes on append)', async () => {
    // page 2 with limit 5 → request total 10; the client appends + dedupes, so
    // the orchestrator returns the full cumulative video list.
    const runner: YtSearchRunner = vi.fn(async (_q, count) =>
      ndjson(Array.from({ length: count }, (_, i) => entry(i))),
    );
    const resp = await searchYouTube({ query: 'cats', limit: 5, page: 2 }, runner);
    expect(runner).toHaveBeenCalledWith('cats', 10, undefined);
    expect(resp.results).toHaveLength(10);
    expect(resp.page).toBe(2);
  });

  it('reports hasMore when yt-dlp returns a full raw batch', async () => {
    // 24 raw entries for a 24-request, with 4 of them channels (filtered out):
    // hasMore must still be true because the *search* was not exhausted.
    const runner: YtSearchRunner = vi.fn(async (_q, count) => ndjson([
      ...Array.from({ length: count - 4 }, (_, i) => entry(i)),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `UC${i}`, ie_key: 'YoutubeTab', title: `Chan ${i}` })),
    ]));
    const resp = await searchYouTube({ query: 'cats', limit: 24, page: 1 }, runner);
    expect(resp.results).toHaveLength(20); // channels filtered out
    expect(resp.hasMore).toBe(true);       // …but more pages still available
  });

  it('reports hasMore=false when the search is exhausted', async () => {
    const runner: YtSearchRunner = vi.fn(async () => ndjson([entry(0), entry(1)]));
    const resp = await searchYouTube({ query: 'obscure', limit: 24, page: 1 }, runner);
    expect(resp.hasMore).toBe(false);
  });

  it('caches identical (query, limit, page) calls', async () => {
    const runner: YtSearchRunner = vi.fn(async () => ndjson([entry(1)]));
    await searchYouTube({ query: 'dogs', limit: 24, page: 1 }, runner);
    await searchYouTube({ query: 'DOGS', limit: 24, page: 1 }, runner); // case-insensitive key
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('propagates a runner failure', async () => {
    const runner: YtSearchRunner = vi.fn(async () => { throw new Error('yt-dlp exited with code 1'); });
    await expect(searchYouTube({ query: 'x' }, runner)).rejects.toThrow(/yt-dlp exited/);
  });
});
