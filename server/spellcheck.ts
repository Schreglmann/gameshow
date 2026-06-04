/**
 * LanguageTool client + allowlist-aware filtering for the German/English
 * spell/grammar check.
 *
 * The endpoint is configurable via `LANGUAGETOOL_URL` (default the free public API
 * `https://api.languagetool.org`), so it can point at a self-hosted instance for
 * offline/private use. Already-existing external API calls (iTunes, MusicBrainz)
 * establish the precedent for server-side outbound fetches.
 *
 * Language handling: content is mostly German but some answers are English (song /
 * movie / band names). We want each field checked in its own language without one
 * request per field (which is unusably slow against the free API's ~20 req/min cap).
 * So with `language=auto` we use a TWO-PASS strategy:
 *   1. Batch many fields into few requests with `language=auto` (dominant detection)
 *      to find candidate issues cheaply.
 *   2. Re-check ONLY the fields that flagged, each on its own with `language=auto`,
 *      so an English answer is detected as English (cleared) and a German typo stays.
 * Requests run CONCURRENTLY, governed by a global SLIDING-WINDOW rate limiter: the free
 * public API allows ~20 requests & ~75 KB per minute, so we let a burst of requests fire
 * immediately and only throttle once a 60 s window is actually full. A normal show needs
 * far fewer than 20 requests, so it completes in a few seconds with no throttling at all.
 * (A self-hosted `LANGUAGETOOL_URL` is never throttled.)
 * A fixed `LANGUAGETOOL_LANGUAGE` (not `auto`) skips pass 2 (single batched pass).
 * See specs/spellcheck.md.
 */

import path from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, rename } from 'fs/promises';
import { spellMatchFingerprint, normalizeAllowedWord } from '../src/utils/spellcheckFingerprint.js';
import { ROOT_DIR } from './asset-paths.js';
import type { SpellcheckConfig } from './spellcheck-allowlist.js';

export interface SpellSegmentInput {
  key: string;
  text: string;
}

export interface LocalMatch {
  message: string;
  shortMessage: string;
  /** Offset LOCAL to the segment text (UTF-16 units). */
  offset: number;
  length: number;
  replacements: string[];
  ruleId: string;
  issueType: string;
  categoryId: string;
  categoryName: string;
  fingerprint: string;
}

export interface SpellSegmentResult {
  key: string;
  matches: LocalMatch[];
}

export type LanguageToolErrorKind = 'unreachable' | 'rate_limited' | 'bad_status';

export class LanguageToolError extends Error {
  kind: LanguageToolErrorKind;
  status?: number;
  constructor(message: string, kind: LanguageToolErrorKind, status?: number) {
    super(message);
    this.name = 'LanguageToolError';
    this.kind = kind;
    this.status = status;
  }
}

interface LtRawMatch {
  message?: string;
  shortMessage?: string;
  offset?: number;
  length?: number;
  replacements?: { value?: string }[];
  rule?: { id?: string; issueType?: string; category?: { id?: string; name?: string } };
}

const DEFAULT_CHUNK_LIMIT = 18_000; // UTF-8 bytes per request, under the ~20 KB free-API cap
const DEFAULT_CONCURRENCY = 6; // parallel in-flight requests (the window governs the actual rate)
// Public-API sliding-window caps. The free API allows ~20 requests & ~75 KB per minute; we
// leave headroom so a burst never trips a 429.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 18;
const MAX_BYTES_PER_WINDOW = 70_000;
const PARAGRAPH_DELIM = '\n\n'; // hard paragraph break — keeps grammar rules from spanning fields
const MAX_REPLACEMENTS = 8;
const LT_LEVEL = 'default';
const PREFERRED_VARIANTS = 'de-DE,en-US';

function configuredLanguage(): string {
  return process.env.LANGUAGETOOL_LANGUAGE?.trim() || 'auto';
}

export interface CheckOptions {
  chunkLimit?: number;
  /** `0` disables the sliding-window limiter (tests + self-hosted overrides). Default: limiter
   *  on for the public API, off otherwise. */
  requestGapMs?: number;
  url?: string;
  /** Override the check language. Default from LANGUAGETOOL_LANGUAGE (`auto`). */
  language?: string;
  /** Max parallel in-flight requests. */
  concurrency?: number;
}

function languageToolUrl(override?: string): string {
  const url = override || process.env.LANGUAGETOOL_URL || 'https://api.languagetool.org';
  return url.replace(/\/+$/, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Global sliding-window rate limiter. The free public API allows ~20 requests & ~75 KB per
// minute, so rather than forcing a fixed gap between every request (which throttled even a tiny
// show to one request every few seconds), we keep a log of recent requests and only make a
// caller wait once a 60 s window is actually full. A normal show fires its handful of requests
// in one burst with no waiting; only large shows / rapid re-scans get throttled.
let windowLog: { at: number; bytes: number }[] = [];
let waitingCount = 0; // requests currently parked in the gate — surfaced live to the UI

function pruneWindow(now: number): void {
  windowLog = windowLog.filter(r => now - r.at < WINDOW_MS);
}

/** Block until a request of `bytes` size fits within the per-minute window, then reserve it. */
async function rateGate(bytes: number): Promise<void> {
  let parked = false;
  try {
    for (;;) {
      const now = Date.now();
      pruneWindow(now);
      const byteSum = windowLog.reduce((s, r) => s + r.bytes, 0);
      const reqFull = windowLog.length >= MAX_REQUESTS_PER_WINDOW;
      const byteFull = windowLog.length > 0 && byteSum + bytes > MAX_BYTES_PER_WINDOW;
      if (!reqFull && !byteFull) {
        windowLog.push({ at: now, bytes }); // reserve synchronously (no await between check & push)
        return;
      }
      if (!parked) { parked = true; waitingCount++; }
      // Wait until the oldest request ages out of the window, then re-evaluate.
      await sleep(Math.max(50, WINDOW_MS - (now - windowLog[0].at) + 20));
    }
  } finally {
    if (parked) waitingCount--;
  }
}

/** Live limiter status for the UI: whether requests are currently being throttled, how many are
 *  parked, and roughly how long until the window frees up. All zero/false when not rate-limited. */
export function getRateLimitStatus(): {
  throttling: boolean;
  waiting: number;
  retryAfterMs: number;
  windowCount: number;
  windowMax: number;
} {
  const now = Date.now();
  pruneWindow(now);
  const windowCount = windowLog.length;
  const full = windowCount >= MAX_REQUESTS_PER_WINDOW;
  const retryAfterMs = (full || waitingCount > 0) && windowCount > 0
    ? Math.max(0, WINDOW_MS - (now - windowLog[0].at))
    : 0;
  return { throttling: waitingCount > 0, waiting: waitingCount, retryAfterMs, windowCount, windowMax: MAX_REQUESTS_PER_WINDOW };
}

/** Gate (only when rate-limited) then issue one LanguageTool request. */
async function gatedRequest(text: string, url: string, language: string, limited: boolean): Promise<LtRawMatch[]> {
  if (limited) await rateGate(Buffer.byteLength(text, 'utf8'));
  return requestLanguageTool(text, url, language);
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]);
  });
  await Promise.all(runners);
}

async function requestLanguageTool(text: string, url: string, language: string): Promise<LtRawMatch[]> {
  const params: Record<string, string> = { text, language, level: LT_LEVEL };
  if (language === 'auto') params.preferredVariants = PREFERRED_VARIANTS;
  const body = new URLSearchParams(params);
  let resp: Response;
  try {
    resp = await fetch(`${url}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new LanguageToolError('LanguageTool nicht erreichbar', 'unreachable');
  }
  if (resp.status === 429) throw new LanguageToolError('LanguageTool: Ratenlimit erreicht', 'rate_limited', 429);
  if (!resp.ok) throw new LanguageToolError(`LanguageTool antwortete mit ${resp.status}`, 'bad_status', resp.status);
  const data = (await resp.json()) as { matches?: LtRawMatch[] };
  return Array.isArray(data.matches) ? data.matches : [];
}

function isSpellingMatch(m: LocalMatch): boolean {
  return m.issueType === 'misspelling' || /^MORFOLOGIK/i.test(m.ruleId) || m.categoryId.toUpperCase() === 'TYPOS';
}

/** Build a LocalMatch from a raw match. `delta` is subtracted from the raw (global) offset to
 *  make it local to `text` (used when matches come from a concatenated chunk). */
function rawToLocal(m: LtRawMatch, text: string, delta: number): LocalMatch {
  const offset = (m.offset ?? 0) - delta;
  const length = m.length ?? 0;
  const matched = text.slice(offset, offset + length);
  const ruleId = m.rule?.id ?? '';
  return {
    message: m.message ?? '',
    shortMessage: m.shortMessage ?? '',
    offset,
    length,
    replacements: (m.replacements ?? []).map(r => r.value ?? '').filter(v => v.length > 0).slice(0, MAX_REPLACEMENTS),
    ruleId,
    issueType: m.rule?.issueType ?? '',
    categoryId: m.rule?.category?.id ?? '',
    categoryName: m.rule?.category?.name ?? '',
    fingerprint: spellMatchFingerprint(ruleId, matched),
  };
}

interface Chunk {
  entries: { key: string; text: string; start: number; end: number }[];
  concat: string;
}

/** Greedily pack segments into ≤ chunkLimit (UTF-8 bytes) chunks joined by PARAGRAPH_DELIM. */
function packChunks(segments: SpellSegmentInput[], chunkLimit: number): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: SpellSegmentInput[] = [];
  let curBytes = 0;
  const flush = () => {
    if (cur.length === 0) return;
    let concat = '';
    const entries: Chunk['entries'] = [];
    for (const seg of cur) {
      if (concat.length > 0) concat += PARAGRAPH_DELIM;
      const start = concat.length;
      concat += seg.text;
      entries.push({ key: seg.key, text: seg.text, start, end: concat.length });
    }
    chunks.push({ entries, concat });
    cur = [];
    curBytes = 0;
  };
  for (const seg of segments) {
    const segBytes = Buffer.byteLength(seg.text, 'utf8');
    const delimBytes = cur.length === 0 ? 0 : PARAGRAPH_DELIM.length;
    if (cur.length > 0 && curBytes + delimBytes + segBytes > chunkLimit) flush();
    cur.push(seg);
    curBytes += (cur.length === 1 ? 0 : delimBytes) + segBytes;
  }
  flush();
  return chunks;
}

/** Map one chunk's raw matches back to per-segment LocalMatch[] (local offsets, unfiltered). */
function mapRawToSegments(chunk: Chunk, raw: LtRawMatch[]): Map<string, LocalMatch[]> {
  const out = new Map<string, LocalMatch[]>();
  for (const e of chunk.entries) out.set(e.key, []);
  for (const m of raw) {
    const globalOffset = m.offset ?? 0;
    const length = m.length ?? 0;
    const entry = chunk.entries.find(e => globalOffset >= e.start && globalOffset < e.end);
    if (!entry) continue;
    if (globalOffset + length > entry.end) continue; // straddles the delimiter — drop
    (out.get(entry.key) as LocalMatch[]).push(rawToLocal(m, entry.text, entry.start));
  }
  return out;
}

// In-memory cache of a field's TRUE (per-field language) matches, keyed by language + text.
// Values are UNFILTERED (allowlist is applied at read time, so allow/ignore changes take effect
// without invalidating the cache). Bounded LRU — repeat scans / re-checks after an edit are free.
const RESPONSE_CACHE_MAX = 5000;
const responseCache = new Map<string, LocalMatch[]>();
const cacheKeyFor = (language: string, text: string) => `${language} ${text}`;
const CACHE_VERSION = 1;
const CACHE_FILE = path.join(ROOT_DIR, '.spellcheck-cache.json');
const PERSIST = !process.env.VITEST && process.env.NODE_ENV !== 'test'; // never touch disk in unit tests
let cacheLoaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// PERSISTED to a gitignored sidecar so the cache survives server restarts (incl. `tsx watch`
// reloads in dev): once content has been scanned, re-scanning after a restart makes no API calls.
/** Load the persisted cache once, lazily, before the first check. */
async function ensureCacheLoaded(): Promise<void> {
  if (cacheLoaded) return;
  cacheLoaded = true;
  if (!PERSIST || !existsSync(CACHE_FILE)) return;
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE, 'utf8')) as { version?: number; entries?: [string, LocalMatch[]][] };
    if (!parsed || parsed.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) return;
    for (const [k, v] of parsed.entries.slice(-RESPONSE_CACHE_MAX)) {
      if (typeof k === 'string' && Array.isArray(v)) responseCache.set(k, v);
    }
  } catch { /* corrupt/old cache → start empty */ }
}

function scheduleCacheSave(): void {
  if (!PERSIST || saveTimer) return; // coalesce a burst of writes into one save
  saveTimer = setTimeout(() => { saveTimer = null; void persistCache(); }, 1500);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

async function persistCache(): Promise<void> {
  try {
    const tmp = `${CACHE_FILE}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ version: CACHE_VERSION, entries: [...responseCache.entries()] })}\n`, 'utf8');
    await rename(tmp, CACHE_FILE);
  } catch { /* best-effort cache — ignore write errors */ }
}

function cacheGet(key: string): LocalMatch[] | undefined {
  const v = responseCache.get(key);
  if (v) { responseCache.delete(key); responseCache.set(key, v); } // refresh LRU order
  return v;
}
function cacheSet(key: string, value: LocalMatch[]): void {
  responseCache.set(key, value);
  if (responseCache.size > RESPONSE_CACHE_MAX) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  scheduleCacheSave();
}
/** Test hook: reset the cache + rate-limiter window between tests. */
export function _resetSpellcheckState(): void {
  responseCache.clear();
  windowLog = [];
  waitingCount = 0;
  cacheLoaded = false;
}

/**
 * Check the given segments and return per-segment matches with local offsets,
 * already filtered against the allowlist. Per-field results are cached (by
 * language + text), so re-scans and re-checks after an edit reuse prior responses.
 */
export async function checkSegments(
  segments: SpellSegmentInput[],
  config: SpellcheckConfig,
  opts: CheckOptions = {},
): Promise<SpellSegmentResult[]> {
  const url = languageToolUrl(opts.url);
  const language = opts.language ?? configuredLanguage();
  const chunkLimit = opts.chunkLimit ?? DEFAULT_CHUNK_LIMIT;
  const isPublicApi = url.includes('languagetool.org');
  // requestGapMs===0 force-disables the limiter (tests + self-hosted overrides); the public API
  // uses the sliding window. Requests run concurrently in both cases — the window caps the rate.
  const limited = isPublicApi && (opts.requestGapMs ?? 1) !== 0;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);

  await ensureCacheLoaded();

  const allowedSet = new Set(config.allowedWords.map(normalizeAllowedWord));
  const ignoredSet = new Set(config.ignoredMatches);

  const checkable = segments.filter(s => s.text.trim().length > 0);

  // Unfiltered per-field matches (the cacheable truth). Fill from cache, compute the rest.
  const unfiltered = new Map<string, LocalMatch[]>();
  const uncached: SpellSegmentInput[] = [];
  for (const seg of checkable) {
    const hit = cacheGet(cacheKeyFor(language, seg.text));
    if (hit) unfiltered.set(seg.key, hit);
    else uncached.push(seg);
  }

  if (uncached.length > 0) {
    const chunks = packChunks(uncached, chunkLimit);
    if (language !== 'auto') {
      // Single batched pass in a fixed language — chunks run concurrently.
      await pool(chunks, concurrency, async (chunk) => {
        const raw = await gatedRequest(chunk.concat, url, language, limited);
        const mapped = mapRawToSegments(chunk, raw);
        for (const [k, arr] of mapped) unfiltered.set(k, arr);
      });
    } else {
      // Pass 1 — batched auto-detect to find candidate fields cheaply (chunks concurrent).
      const candidate = new Map<string, LocalMatch[]>();
      await pool(chunks, concurrency, async (chunk) => {
        const raw = await gatedRequest(chunk.concat, url, 'auto', limited);
        const mapped = mapRawToSegments(chunk, raw);
        for (const [k, arr] of mapped) { candidate.set(k, arr); unfiltered.set(k, []); }
      });
      // Pass 2 — re-check ONLY flagged fields individually so each field's own language wins.
      const flagged = uncached.filter(s => (candidate.get(s.key)?.length ?? 0) > 0);
      await pool(flagged, concurrency, async (seg) => {
        const raw = await gatedRequest(seg.text, url, 'auto', limited);
        unfiltered.set(seg.key, raw.map(m => rawToLocal(m, seg.text, 0)));
      });
    }
    // Cache every uncached field's computed result.
    for (const seg of uncached) cacheSet(cacheKeyFor(language, seg.text), unfiltered.get(seg.key) ?? []);
  }

  // Apply the allowlist at read time and assemble the response.
  return segments.map(s => {
    const locals = unfiltered.get(s.key) ?? [];
    const matches = locals.filter(lm => {
      const matched = s.text.slice(lm.offset, lm.offset + lm.length);
      if (isSpellingMatch(lm) && allowedSet.has(normalizeAllowedWord(matched))) return false;
      if (ignoredSet.has(lm.fingerprint)) return false;
      return true;
    });
    return { key: s.key, matches };
  });
}

export async function checkLanguageToolHealth(opts: CheckOptions = {}): Promise<{ ok: boolean; url: string; reason?: string }> {
  const url = languageToolUrl(opts.url);
  try {
    const resp = await fetch(`${url}/v2/languages`, { signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) return { ok: false, url, reason: `status ${resp.status}` };
    return { ok: true, url };
  } catch {
    return { ok: false, url, reason: 'unreachable' };
  }
}
