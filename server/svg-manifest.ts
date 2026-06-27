/**
 * SVG logo manifests — flat indices of every SVG path in the public logo repos
 * (gilbarbara/logos, detain/svg-logos, simple-icons), used by the `github-svg`
 * image-search provider so the admin can browse + download single logos on
 * demand instead of cloning the full repos locally.
 *
 * One manifest file per source, persisted as a dotfile under
 * `<localAssetsBase>/.svg-manifests/<id>.json`. Each entry stores
 * `{ path, name, searchKey }` where `searchKey` is the precomputed
 * lowercased + separator-normalised form used by `matchesSearchKey`.
 *
 * Sources:
 *   - gilbarbara/logos@main — GitHub Trees API (~1.8k entries, not truncated)
 *   - simple-icons@develop  — GitHub Trees API (~3.5k entries, not truncated)
 *   - detain/svg-logos@master — `svgs.json` index in the repo root (the Trees
 *     API truncates at ~100k for this repo, so we use the authoritative JSON
 *     instead). Paths are derived: `svg/{firstChar(id)}/{id}.svg`.
 *
 * Refresh policy: the orchestrator calls `loadManifests` once at startup. If a
 * manifest is missing OR older than `STALE_AFTER_MS` (30 days), it is rebuilt
 * in the background. The admin System tab exposes `refreshManifest` /
 * `deleteManifest` for manual control.
 */

import path from 'path';
import { existsSync, statSync } from 'fs';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';

export const SVG_MANIFEST_SUBDIR = '.svg-manifests';
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export type SvgManifestId = 'gilbarbara' | 'detain' | 'simple-icons';

export interface SvgManifestEntry {
  /** Path inside the source repo, e.g. `logos/audi.svg`. */
  path: string;
  /** Bare filename for display + dedup, e.g. `audi.svg`. */
  name: string;
  /** Precomputed lower + normalised string used by matchesSearchKey. */
  searchKey: string;
}

export interface SvgManifest {
  id: SvgManifestId;
  builtAt: number;
  entries: SvgManifestEntry[];
}

export interface SvgManifestStatus {
  id: SvgManifestId;
  label: string;
  count: number;
  builtAt: number | null;
  sizeBytes: number;
  stale: boolean;
}

export interface SvgRepoSource {
  id: SvgManifestId;
  label: string;
  repo: string;
  branch: string;
  /** Maps a manifest entry's `path` to a raw download URL. */
  toRawUrl(p: string): string;
}

const SOURCES: SvgRepoSource[] = [
  {
    id: 'gilbarbara',
    label: 'gilbarbara/logos (colored, curated)',
    repo: 'gilbarbara/logos',
    branch: 'main',
    toRawUrl: p => `https://raw.githubusercontent.com/gilbarbara/logos/main/${p}`,
  },
  {
    id: 'detain',
    label: 'detain/svg-logos (colored, bulk)',
    repo: 'detain/svg-logos',
    branch: 'master',
    toRawUrl: p => `https://raw.githubusercontent.com/detain/svg-logos/master/${p}`,
  },
  {
    id: 'simple-icons',
    label: 'simple-icons (monochrome, broad)',
    repo: 'simple-icons/simple-icons',
    branch: 'develop',
    toRawUrl: p => `https://raw.githubusercontent.com/simple-icons/simple-icons/develop/${p}`,
  },
];

const ALL_IDS = SOURCES.map(s => s.id);
const sourceById = new Map<SvgManifestId, SvgRepoSource>(SOURCES.map(s => [s.id, s]));

let manifestDir = '';
const manifests = new Map<SvgManifestId, SvgManifest>();
const inflight = new Map<SvgManifestId, Promise<SvgManifest>>();

/**
 * Same algorithm as `buildSearchKey` in `src/components/backend/AssetPicker.tsx`.
 * Duplicated so the server doesn't import a frontend module.
 */
export function buildSearchKey(file: string): string {
  const lower = file.toLowerCase();
  return `${lower} ${lower.replace(/[-_.]+/g, ' ')}`;
}

export function tokenizeSearch(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function matchesSearchKey(searchKey: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  for (const t of tokens) if (!searchKey.includes(t)) return false;
  return true;
}

function manifestFilePath(id: SvgManifestId): string {
  return path.join(manifestDir, `${id}.json`);
}

/**
 * Bootstrap. Resolves once on-disk manifests are loaded into memory, then
 * schedules background refreshes for any source that is missing or stale.
 *
 * `awaitRefresh` is for tests — when true, the returned promise also waits
 * for those background refreshes to complete. Production callers should not
 * set it: a missing manifest must never block server startup on a slow
 * GitHub fetch.
 */
export async function loadManifests(
  localAssetsBase: string,
  options?: { awaitRefresh?: boolean },
): Promise<void> {
  manifestDir = path.join(localAssetsBase, SVG_MANIFEST_SUBDIR);
  await mkdir(manifestDir, { recursive: true });

  await Promise.all(SOURCES.map(async source => {
    const file = manifestFilePath(source.id);
    if (!existsSync(file)) return;
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SvgManifest>;
      if (
        parsed && typeof parsed.builtAt === 'number' && Array.isArray(parsed.entries) &&
        parsed.entries.every(e => e && typeof e.path === 'string' && typeof e.name === 'string' && typeof e.searchKey === 'string')
      ) {
        manifests.set(source.id, { id: source.id, builtAt: parsed.builtAt, entries: parsed.entries });
      }
    } catch {
      // Corrupt manifest — leave it absent, the refresh below will rebuild it.
    }
  }));

  // Fire background refreshes for missing or stale manifests.
  const pending: Promise<unknown>[] = [];
  for (const source of SOURCES) {
    const current = manifests.get(source.id);
    const stale = !current || Date.now() - current.builtAt > STALE_AFTER_MS;
    if (stale) {
      pending.push(refreshManifest(source.id).catch(err => {
        console.warn(`[svg-manifest] background refresh of ${source.id} failed: ${err instanceof Error ? err.message : err}`);
      }));
    }
  }
  if (options?.awaitRefresh) await Promise.all(pending);
}

export function getManifestStatus(): SvgManifestStatus[] {
  return SOURCES.map(source => {
    const m = manifests.get(source.id);
    let sizeBytes = 0;
    try {
      const f = manifestFilePath(source.id);
      if (existsSync(f)) sizeBytes = statSync(f).size;
    } catch { /* ignore */ }
    return {
      id: source.id,
      label: source.label,
      count: m?.entries.length ?? 0,
      builtAt: m?.builtAt ?? null,
      sizeBytes,
      stale: !m || Date.now() - m.builtAt > STALE_AFTER_MS,
    };
  });
}

export async function refreshManifest(id: SvgManifestId): Promise<SvgManifest> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const source = sourceById.get(id);
  if (!source) throw new Error(`Unknown SVG manifest source: ${id}`);
  // Guard: if `loadManifests` hasn't initialised the directory yet, we must NOT
  // proceed — `manifestFilePath` would resolve to a relative path and dump the
  // manifest into the current working directory (caught the hard way during
  // test development).
  if (!manifestDir) throw new Error('svg-manifest: loadManifests() must run before refreshManifest()');

  const job = (async (): Promise<SvgManifest> => {
    const entries = source.id === 'detain'
      ? await fetchDetainEntries()
      : await fetchEntriesViaTreesApi(source);
    const manifest: SvgManifest = { id: source.id, builtAt: Date.now(), entries };
    manifests.set(source.id, manifest);
    await mkdir(manifestDir, { recursive: true });
    await writeFile(manifestFilePath(source.id), JSON.stringify(manifest) + '\n', 'utf8');
    return manifest;
  })().finally(() => inflight.delete(id));

  inflight.set(id, job);
  return job;
}

export async function refreshAllManifests(): Promise<SvgManifest[]> {
  return Promise.all(ALL_IDS.map(refreshManifest));
}

export async function deleteManifest(id: SvgManifestId): Promise<void> {
  manifests.delete(id);
  const f = manifestFilePath(id);
  if (existsSync(f)) await unlink(f);
}

export async function deleteAllManifests(): Promise<void> {
  await Promise.all(ALL_IDS.map(deleteManifest));
}

export interface SvgManifestHit {
  source: SvgManifestId;
  path: string;
  name: string;
  url: string;
}

// Generic descriptors that don't help narrow the search inside a *logo*
// collection. "audi logo" should produce the same results as "audi".
const SEARCH_STOPWORDS = new Set(['logo', 'logos', 'logotype', 'icon', 'icons', 'svg', 'svgs', 'vector', 'brand', 'brands']);

/**
 * Filter every loaded manifest by `query`, dedupe by name (so the same logo
 * surfacing in multiple repos collapses to one hit), then page.
 *
 * Ranking is tiered so that entries whose *filename* matches the query rank
 * above entries that only match via tag metadata (detain's `tags[]` is folded
 * into the searchKey, so e.g. `t3.svg` tagged "audi" passes the filter but
 * shouldn't outrank `audi.svg`). Within a tier we prefer shorter names
 * (`audi.svg` > `audi-12.svg`), then alphabetical.
 */
export function searchManifests(query: string, limit: number, offset = 0): SvgManifestHit[] {
  const rawTokens = tokenizeSearch(query);
  if (rawTokens.length === 0) return [];
  // Strip stopwords; fall back to the raw tokens if the user only typed stopwords
  // (so the filter still does something rather than returning the entire corpus).
  const meaningful = rawTokens.filter(t => !SEARCH_STOPWORDS.has(t));
  const tokens = meaningful.length > 0 ? meaningful : rawTokens;

  interface Scored { hit: SvgManifestHit; nameMatch: boolean; nameLen: number; }
  const seen = new Set<string>();
  const scored: Scored[] = [];
  for (const source of SOURCES) {
    const manifest = manifests.get(source.id);
    if (!manifest) continue;
    const sourceFoldsTags = source.id === 'detain';
    for (const entry of manifest.entries) {
      if (!matchesSearchKey(entry.searchKey, tokens)) continue;
      const dedupKey = entry.name.toLowerCase();
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      // For gilbarbara + simple-icons, searchKey is derived from the filename
      // alone, so a successful filter already implies a name match. For detain,
      // searchKey includes tags + display name, so we re-test against the
      // filename to bucket the result.
      const nameMatch = sourceFoldsTags ? matchesSearchKey(buildSearchKey(entry.name), tokens) : true;
      scored.push({
        hit: {
          source: source.id,
          path: entry.path,
          name: entry.name,
          url: source.toRawUrl(entry.path),
        },
        nameMatch,
        nameLen: entry.name.length,
      });
    }
  }
  scored.sort((a, b) => {
    if (a.nameMatch !== b.nameMatch) return a.nameMatch ? -1 : 1;
    if (a.nameLen !== b.nameLen) return a.nameLen - b.nameLen;
    return a.hit.name.localeCompare(b.hit.name);
  });
  return scored.slice(offset, offset + limit).map(s => s.hit);
}

interface TreesApiResponse {
  tree: { path: string; type: string }[];
  truncated: boolean;
}

async function fetchEntriesViaTreesApi(source: SvgRepoSource): Promise<SvgManifestEntry[]> {
  const url = `https://api.github.com/repos/${source.repo}/git/trees/${source.branch}?recursive=1`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'gameshow-svg-manifest/1.0',
    },
  });
  if (!res.ok) throw new Error(`GitHub Trees API ${source.repo}@${source.branch} → ${res.status}`);
  const json = await res.json() as TreesApiResponse;
  if (json.truncated) {
    console.warn(`[svg-manifest] GitHub Trees API returned truncated:true for ${source.repo}@${source.branch}; manifest will be incomplete`);
  }
  const pathFilter = source.id === 'gilbarbara'
    ? (p: string) => p.startsWith('logos/') && p.endsWith('.svg')
    : (p: string) => p.startsWith('icons/') && p.endsWith('.svg');
  const entries: SvgManifestEntry[] = [];
  for (const node of json.tree) {
    if (node.type !== 'blob') continue;
    if (!pathFilter(node.path)) continue;
    const name = node.path.split('/').pop() ?? node.path;
    entries.push({ path: node.path, name, searchKey: buildSearchKey(name) });
  }
  return entries;
}

interface DetainSvgEntry {
  id: string;
  name?: string;
  tags?: string[];
}

async function fetchDetainEntries(): Promise<SvgManifestEntry[]> {
  // The Trees API truncates this repo, so we fetch the authoritative index
  // committed to the repo root. ~23 MB JSON. Paths follow the convention
  // `svg/{firstChar}/{id}.svg` (alpha-bucketed by first character of id).
  const url = 'https://raw.githubusercontent.com/detain/svg-logos/master/svgs.json';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'gameshow-svg-manifest/1.0' },
  });
  if (!res.ok) throw new Error(`detain svgs.json → ${res.status}`);
  const data = await res.json() as Record<string, DetainSvgEntry>;
  const entries: SvgManifestEntry[] = [];
  for (const [id, info] of Object.entries(data)) {
    if (!id) continue;
    const first = id[0]!.toLowerCase();
    const bucket = /[a-z0-9]/.test(first) ? first : '0';
    const filePath = `svg/${bucket}/${id}.svg`;
    // Build the search key from id + display name + tags so a query on the
    // human brand (e.g. "Apple") matches IDs like `apple-11`.
    const haystack = [id, info.name ?? '', ...(info.tags ?? [])].join(' ');
    entries.push({
      path: filePath,
      name: `${id}.svg`,
      searchKey: buildSearchKey(haystack),
    });
  }
  return entries;
}

// Test hook
export function _resetForTests(): void {
  manifests.clear();
  inflight.clear();
  manifestDir = '';
}
