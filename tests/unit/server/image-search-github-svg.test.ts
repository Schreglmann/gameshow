import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtemp, rm } from 'fs/promises';
import {
  loadManifests,
  _resetForTests,
} from '../../../server/svg-manifest.js';
import { searchGithubSvg } from '../../../server/image-search-github-svg.js';

let tmpBase = '';
interface QueueEntry { ok: boolean; status: number; body: unknown }
let routes: Map<RegExp, QueueEntry[]>;

function queueResponse(matcher: RegExp, entry: QueueEntry): void {
  const existing = routes.get(matcher) ?? [];
  existing.push(entry);
  routes.set(matcher, existing);
}
function findRoute(url: string): QueueEntry | undefined {
  for (const [pat, entries] of routes.entries()) {
    if (pat.test(url) && entries.length > 0) return entries.shift();
  }
  return undefined;
}

beforeEach(async () => {
  tmpBase = await mkdtemp(path.join(os.tmpdir(), 'github-svg-provider-'));
  routes = new Map();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const match = findRoute(url);
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    return {
      ok: match.ok,
      status: match.status,
      json: async () => match.body,
      text: async () => JSON.stringify(match.body),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as Response;
  }));
  _resetForTests();

  queueResponse(/api\.github\.com.*gilbarbara/, { ok: true, status: 200, body: {
    tree: [
      { path: 'logos/audi.svg', type: 'blob' },
      { path: 'logos/porsche.svg', type: 'blob' },
    ],
    truncated: false,
  } });
  queueResponse(/api\.github\.com.*simple-icons/, { ok: true, status: 200, body: { tree: [], truncated: false } });
  queueResponse(/raw\.githubusercontent\.com.*svgs\.json/, { ok: true, status: 200, body: {} });

  await loadManifests(tmpBase, { awaitRefresh: true });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  _resetForTests();
  await rm(tmpBase, { recursive: true, force: true });
});

describe('searchGithubSvg provider', () => {
  it('returns RawImageSearchResult-shaped hits with source = "github-svg"', async () => {
    const results = await searchGithubSvg('audi', 10);
    expect(results.length).toBe(1);
    const r = results[0];
    expect(r.source).toBe('github-svg');
    expect(r.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/gilbarbara\/logos\/main\/logos\/audi\.svg$/);
    expect(r.thumbnailUrl).toBe(r.url);
    expect(r.title).toBe('audi');
  });

  it('honors limit and offset for pagination', async () => {
    const page1 = await searchGithubSvg('s', 1, undefined, 0);
    const page2 = await searchGithubSvg('s', 1, undefined, 1);
    expect(page1.length).toBe(1);
    // Either porsche or no second match — both pages return distinct URLs.
    if (page2.length > 0) expect(page2[0].url).not.toBe(page1[0].url);
  });

  it('returns [] for an empty query rather than dumping the whole manifest', async () => {
    expect(await searchGithubSvg('', 10)).toEqual([]);
  });

  it('throws when the abort signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(searchGithubSvg('audi', 10, ctrl.signal)).rejects.toThrow();
  });
});
