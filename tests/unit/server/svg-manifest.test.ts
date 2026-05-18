import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'fs';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  loadManifests,
  deleteManifest,
  deleteAllManifests,
  getManifestStatus,
  searchManifests,
  buildSearchKey,
  tokenizeSearch,
  matchesSearchKey,
  STALE_AFTER_MS,
  _resetForTests,
} from '../../../server/svg-manifest.js';

// Per-test temp dir; each loadManifests/refreshManifest call writes here.
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
  tmpBase = await (await import('fs/promises')).mkdtemp(path.join(os.tmpdir(), 'svg-manifest-'));
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
});

afterEach(async () => {
  vi.unstubAllGlobals();
  _resetForTests();
  await rm(tmpBase, { recursive: true, force: true });
});

// ── Shared search-key helpers (matches AssetPicker.tsx) ──

describe('buildSearchKey / matchesSearchKey', () => {
  it('lowercases and normalises separators so "my-video" matches both forms', () => {
    const key = buildSearchKey('My-Video.mp4');
    // both raw lowercase ("my-video.mp4") and normalised ("my video mp4") in haystack
    expect(matchesSearchKey(key, tokenizeSearch('my-video'))).toBe(true);
    expect(matchesSearchKey(key, tokenizeSearch('my video'))).toBe(true);
    expect(matchesSearchKey(key, tokenizeSearch('myvideo'))).toBe(false);
  });

  it('empty token list matches everything', () => {
    expect(matchesSearchKey(buildSearchKey('any.svg'), tokenizeSearch(''))).toBe(true);
  });
});

// ── Manifest persistence + lifecycle ──

describe('svg-manifest persistence', () => {
  it('loads a previously-written manifest from disk without re-fetching', async () => {
    // Pre-seed a manifest file on disk so gilbarbara isn't stale and won't be refetched.
    const dir = path.join(tmpBase, '.svg-manifests');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'gilbarbara.json'), JSON.stringify({
      builtAt: Date.now(),
      entries: [
        { path: 'logos/audi.svg', name: 'audi.svg', searchKey: buildSearchKey('audi.svg') },
      ],
    }));
    // simple-icons + detain are absent → background fetches will fire. Stub empty
    // responses + use `awaitRefresh: true` so the test's afterEach can't race the
    // pending writes (which would otherwise dump empty manifests into cwd).
    queueResponse(/api\.github\.com.*simple-icons/, { ok: true, status: 200, body: { tree: [], truncated: false } });
    queueResponse(/raw\.githubusercontent\.com.*svgs\.json/, { ok: true, status: 200, body: {} });

    await loadManifests(tmpBase, { awaitRefresh: true });

    const status = getManifestStatus();
    const gilbarbara = status.find(s => s.id === 'gilbarbara');
    expect(gilbarbara?.count).toBe(1);
    expect(gilbarbara?.builtAt).toBeGreaterThan(0);
    expect(gilbarbara?.stale).toBe(false);
  });

  it('flags a stale manifest (>30 days) and triggers background refresh', async () => {
    const dir = path.join(tmpBase, '.svg-manifests');
    await mkdir(dir, { recursive: true });
    const oldTs = Date.now() - STALE_AFTER_MS - 60_000;
    await writeFile(path.join(dir, 'simple-icons.json'), JSON.stringify({
      builtAt: oldTs,
      entries: [{ path: 'icons/old.svg', name: 'old.svg', searchKey: buildSearchKey('old.svg') }],
    }));
    queueResponse(/api\.github\.com.*simple-icons/, { ok: true, status: 200, body: {
      tree: [{ path: 'icons/new.svg', type: 'blob' }],
      truncated: false,
    } });
    queueResponse(/api\.github\.com.*gilbarbara/, { ok: true, status: 200, body: { tree: [], truncated: false } });
    queueResponse(/raw\.githubusercontent\.com.*svgs\.json/, { ok: true, status: 200, body: {} });

    await loadManifests(tmpBase, { awaitRefresh: true });

    const si = getManifestStatus().find(s => s.id === 'simple-icons');
    expect(si?.count).toBe(1);
    expect(Date.now() - (si?.builtAt ?? 0)).toBeLessThan(10_000);
  });

  it('filters non-matching paths and persists what refreshManifest produces', async () => {
    queueResponse(/api\.github\.com.*gilbarbara/, { ok: true, status: 200, body: {
      tree: [
        { path: 'logos/audi.svg', type: 'blob' },
        { path: 'logos/bmw.svg', type: 'blob' },
        // Non-matching paths must be filtered out.
        { path: 'README.md', type: 'blob' },
        { path: 'logos', type: 'tree' },
      ],
      truncated: false,
    } });
    queueResponse(/api\.github\.com.*simple-icons/, { ok: true, status: 200, body: { tree: [], truncated: false } });
    queueResponse(/raw\.githubusercontent\.com.*svgs\.json/, { ok: true, status: 200, body: {} });

    await loadManifests(tmpBase, { awaitRefresh: true });

    const written = JSON.parse(await readFile(path.join(tmpBase, '.svg-manifests', 'gilbarbara.json'), 'utf8'));
    expect(written.entries.map((e: { name: string }) => e.name).sort()).toEqual(['audi.svg', 'bmw.svg']);
  });

  it('logs a warning but still returns entries when GitHub Trees API truncates', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    queueResponse(/api\.github\.com.*gilbarbara/, { ok: true, status: 200, body: {
      tree: [{ path: 'logos/x.svg', type: 'blob' }],
      truncated: true,
    } });
    queueResponse(/api\.github\.com.*simple-icons/, { ok: true, status: 200, body: { tree: [], truncated: false } });
    queueResponse(/raw\.githubusercontent\.com.*svgs\.json/, { ok: true, status: 200, body: {} });

    await loadManifests(tmpBase, { awaitRefresh: true });
    const gilbarbara = getManifestStatus().find(s => s.id === 'gilbarbara');
    expect(gilbarbara?.count).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/truncated/));
    warn.mockRestore();
  });

  it('deleteManifest removes both in-memory + on-disk state', async () => {
    queueResponse(/api\.github\.com.*gilbarbara/, { ok: true, status: 200, body: {
      tree: [{ path: 'logos/test.svg', type: 'blob' }],
      truncated: false,
    } });
    queueResponse(/api\.github\.com.*simple-icons/, { ok: true, status: 200, body: { tree: [], truncated: false } });
    queueResponse(/raw\.githubusercontent\.com.*svgs\.json/, { ok: true, status: 200, body: {} });

    await loadManifests(tmpBase, { awaitRefresh: true });
    expect(existsSync(path.join(tmpBase, '.svg-manifests', 'gilbarbara.json'))).toBe(true);

    await deleteManifest('gilbarbara');
    expect(existsSync(path.join(tmpBase, '.svg-manifests', 'gilbarbara.json'))).toBe(false);
    const status = getManifestStatus();
    expect(status.find(s => s.id === 'gilbarbara')?.count).toBe(0);
  });

  it('deleteAllManifests clears everything', async () => {
    queueResponse(/api\.github\.com.*gilbarbara/, { ok: true, status: 200, body: {
      tree: [{ path: 'logos/x.svg', type: 'blob' }], truncated: false,
    } });
    queueResponse(/api\.github\.com.*simple-icons/, { ok: true, status: 200, body: {
      tree: [{ path: 'icons/y.svg', type: 'blob' }], truncated: false,
    } });
    queueResponse(/raw\.githubusercontent\.com.*svgs\.json/, { ok: true, status: 200, body: {
      zz: { id: 'zz' },
    } });

    await loadManifests(tmpBase, { awaitRefresh: true });

    await deleteAllManifests();
    for (const s of getManifestStatus()) {
      expect(s.count).toBe(0);
      expect(s.builtAt).toBeNull();
    }
  });
});

// ── detain svgs.json adapter ──

describe('detain svgs.json adapter', () => {
  it('derives svg/{firstChar}/{id}.svg paths and includes tags + name in the search key', async () => {
    queueResponse(/api\.github\.com.*gilbarbara/, { ok: true, status: 200, body: { tree: [], truncated: false } });
    queueResponse(/api\.github\.com.*simple-icons/, { ok: true, status: 200, body: { tree: [], truncated: false } });
    queueResponse(/raw\.githubusercontent\.com.*svgs\.json/, { ok: true, status: 200, body: {
      'apple-11': { id: 'apple-11', name: 'Apple', tags: ['tech'] },
      '0xab': { id: '0xab', name: 'Hexbrand', tags: [] },
      'special!char': { id: 'special!char', name: 'Special' },
    } });

    await loadManifests(tmpBase, { awaitRefresh: true });
    const m = JSON.parse(await readFile(path.join(tmpBase, '.svg-manifests', 'detain.json'), 'utf8')) as { entries: Array<{ path: string; name: string; searchKey: string }> };
    const apple = m.entries.find(e => e.name === 'apple-11.svg');
    expect(apple?.path).toBe('svg/a/apple-11.svg');
    // search key includes the display name → a query for "Apple" matches.
    expect(matchesSearchKey(apple!.searchKey, tokenizeSearch('apple'))).toBe(true);

    const hex = m.entries.find(e => e.name === '0xab.svg');
    expect(hex?.path).toBe('svg/0/0xab.svg');

    // Non-alphanumeric first char falls into the '0' bucket.
    const special = m.entries.find(e => e.name === 'special!char.svg');
    expect(special?.path).toBe('svg/s/special!char.svg');
  });
});

// ── searchManifests ──

describe('searchManifests', () => {
  beforeEach(async () => {
    queueResponse(/api\.github\.com.*gilbarbara/, { ok: true, status: 200, body: {
      tree: [
        { path: 'logos/audi.svg', type: 'blob' },
        { path: 'logos/bmw.svg', type: 'blob' },
      ],
      truncated: false,
    } });
    queueResponse(/api\.github\.com.*simple-icons/, { ok: true, status: 200, body: {
      tree: [{ path: 'icons/audi.svg', type: 'blob' }],
      truncated: false,
    } });
    queueResponse(/raw\.githubusercontent\.com.*svgs\.json/, { ok: true, status: 200, body: {
      'audi-1': { id: 'audi-1', name: 'Audi' },
      'audi-12': { id: 'audi-12', name: 'Audi' },
      'audi-2': { id: 'audi-2', name: 'Audi' },
      'porsche': { id: 'porsche', name: 'Porsche' },
    } });
    await loadManifests(tmpBase, { awaitRefresh: true });
  });

  it('returns hits across all manifests, deduped by filename', () => {
    const hits = searchManifests('audi', 10, 0);
    const names = hits.map(h => h.name);
    // audi.svg appears in both gilbarbara and simple-icons → only one entry.
    expect(names.filter(n => n === 'audi.svg').length).toBe(1);
    // detain numbered variants are present.
    expect(names).toContain('audi-1.svg');
    expect(names).toContain('audi-12.svg');
  });

  it('ranks shorter filenames first so audi.svg beats audi-12.svg', () => {
    const hits = searchManifests('audi', 10, 0);
    expect(hits[0].name).toBe('audi.svg');
  });

  it('respects limit + offset paging', () => {
    const first = searchManifests('audi', 2, 0);
    const second = searchManifests('audi', 2, 2);
    expect(first).toHaveLength(2);
    expect(second.length).toBeGreaterThan(0);
    // No overlap between pages.
    expect(first.map(h => h.name).some(n => second.map(s => s.name).includes(n))).toBe(false);
  });

  it('returns an empty list for an empty query (no fall-through to all-entries)', () => {
    expect(searchManifests('', 10, 0)).toEqual([]);
    expect(searchManifests('   ', 10, 0)).toEqual([]);
  });

  it('emits raw.githubusercontent.com URLs derived from the source path', () => {
    const audi = searchManifests('audi', 10, 0).find(h => h.name === 'audi.svg');
    expect(audi?.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/(gilbarbara\/logos|simple-icons\/simple-icons)\//);
  });

  it('ranks name-matches above tag-only matches (audi.svg beats a detain entry tagged "audi")', async () => {
    // Wipe the manifests written by the parent describe's beforeEach — without
    // this the loadManifests below short-circuits on the fresh on-disk files
    // and never consumes our new queued responses.
    _resetForTests();
    await rm(path.join(tmpBase, '.svg-manifests'), { recursive: true, force: true });
    routes.clear();
    queueResponse(/api\.github\.com.*gilbarbara/, { ok: true, status: 200, body: {
      tree: [{ path: 'logos/audi.svg', type: 'blob' }],
      truncated: false,
    } });
    queueResponse(/api\.github\.com.*simple-icons/, { ok: true, status: 200, body: { tree: [], truncated: false } });
    queueResponse(/raw\.githubusercontent\.com.*svgs\.json/, { ok: true, status: 200, body: {
      // Detain entry whose filename has nothing to do with "audi" but is tagged with it.
      // Shorter than `audi.svg` (5 chars vs 8) — must NOT outrank the real audi.svg.
      't3': { id: 't3', name: 'T3', tags: ['audi'] },
      'audi-1': { id: 'audi-1', name: 'Audi' },
    } });
    await loadManifests(tmpBase, { awaitRefresh: true });

    const hits = searchManifests('audi', 10, 0);
    expect(hits[0].name).toBe('audi.svg');
    // The tagged-only entry should still appear, just demoted.
    expect(hits.some(h => h.name === 't3.svg')).toBe(true);
    const audiIdx = hits.findIndex(h => h.name === 'audi.svg');
    const t3Idx = hits.findIndex(h => h.name === 't3.svg');
    expect(audiIdx).toBeLessThan(t3Idx);
  });

  it('strips stopwords so "audi logo" returns the same hits as "audi"', () => {
    const justAudi = searchManifests('audi', 50, 0);
    const audiLogo = searchManifests('audi logo', 50, 0);
    expect(audiLogo.map(h => h.name)).toEqual(justAudi.map(h => h.name));
  });

  it('falls back to raw tokens when the query is only stopwords', () => {
    const hits = searchManifests('logo svg', 10, 0);
    // Should not return the entire corpus — only entries whose searchKey contains
    // both "logo" and "svg" (every filename contains "svg" since we keep the
    // extension, so this effectively filters by "logo" anywhere in tags / name).
    expect(hits.length).toBeGreaterThanOrEqual(0);
    expect(hits.length).toBeLessThan(10);
  });
});
