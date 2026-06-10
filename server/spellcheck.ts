/**
 * LanguageTool client + allowlist-aware filtering for the German/English
 * spell/grammar check.
 *
 * The endpoint is configurable via `LANGUAGETOOL_URL` (default the free public API
 * `https://api.languagetool.org`), so it can point at a self-hosted instance for
 * offline/private use. Already-existing external API calls (iTunes, MusicBrainz)
 * establish the precedent for server-side outbound fetches.
 *
 * Language handling: content is mostly German but some answers/titles are English (song /
 * movie / band names). Each field must be checked in its OWN language. With `language=auto`:
 *   1. Pass 1 — ONE batched `auto` pass over ALL fields. Cheap: LanguageTool detects the dominant
 *      language once (German for a German show) and checks the batch efficiently. This is the
 *      German truth for German fields; English content gets German matches whose flagged tokens are
 *      really valid English words.
 *   2. Pass 2 — drop the English false-positives. Collect every DISTINCT token pass-1 flagged as a
 *      misspelling and re-check just those TOKENS (not the full fields) in `en-US`. A real German
 *      typo is foreign to English too, so en-US flags it → keep; an English word ("love", "Knight")
 *      is valid English, so en-US does NOT flag it → drop. Cheap: a handful of short words, one
 *      request.
 * Why not run `en-US` over the whole show? The English speller flags EVERY German word and is very
 * slow — checking only the few flagged tokens is fast. Proper NAMES (no close correction) are
 * suppressed separately by the skipNames heuristic; spelling suppression is language-INDEPENDENT (a
 * token ignored when a field was auto-detected as Italian stays ignored once it is re-detected as
 * German) — see the read-time filter. A self-hosted/local instance packs much bigger chunks
 * (`LOCAL_CHUNK_LIMIT`) and the whole-show scan is batched into one /check, so a full local scan is
 * a couple of requests. Each German /check has a large FIXED cost and the server SERIALIZES them
 * (concurrency hurts), so request COUNT drives wall-clock.
 * Requests are governed by a SLIDING-WINDOW rate limiter on the public API (~20 req & ~75 KB per
 * minute) + a global concurrency cap; a self-hosted `LANGUAGETOOL_URL` is never throttled.
 * A fixed `LANGUAGETOOL_LANGUAGE` (not `auto`) does a single batched pass per chunk.
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
// A self-hosted / local instance has no per-request size cap, so pack much bigger chunks: each
// German /check carries a large fixed cost and the server serializes them, so FEWER (bigger)
// requests is dramatically faster than many small ones. A whole show then fits in ~1 chunk.
const LOCAL_CHUNK_LIMIT = 120_000;
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

// URL of an admin-managed local LanguageTool container (see server/languagetool-docker.ts).
// When set, it takes precedence over LANGUAGETOOL_URL / the public API so the checker uses the
// fast local instance while it runs; cleared when the container is stopped.
let managedLanguageToolUrl: string | null = null;

/** Route the checker at a managed local instance (or `null` to revert to env / public API). */
export function setManagedLanguageToolUrl(url: string | null): void {
  managedLanguageToolUrl = url ? url.replace(/\/+$/, '') : null;
}

function languageToolUrl(override?: string): string {
  const url = override || managedLanguageToolUrl || process.env.LANGUAGETOOL_URL || 'https://api.languagetool.org';
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
      // reqFull/byteFull both imply windowLog is non-empty here.
      await sleep(Math.max(50, WINDOW_MS - (now - windowLog[0]!.at) + 20));
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
    ? Math.max(0, WINDOW_MS - (now - windowLog[0]!.at))
    : 0;
  return { throttling: waitingCount > 0, waiting: waitingCount, retryAfterMs, windowCount, windowMax: MAX_REQUESTS_PER_WINDOW };
}

// Global concurrency cap on outbound /check requests. Even when NOT rate-limited (self-hosted /
// local container), firing dozens of concurrent checks at a freshly-started instance overwhelms it
// (slow first responses, timeouts). This bounds total in-flight requests across every concurrent
// checkSegments call. (For the public API the sliding-window limiter already spaces requests out.)
const MAX_INFLIGHT = 8;
let inflight = 0;
const inflightQueue: Array<() => void> = [];
function acquireSlot(): Promise<void> {
  return new Promise<void>(res => {
    if (inflight < MAX_INFLIGHT) { inflight++; res(); }
    else inflightQueue.push(() => { inflight++; res(); });
  });
}
function releaseSlot(): void {
  inflight = Math.max(0, inflight - 1);
  inflightQueue.shift()?.();
}

// Retry transient failures (unreachable / 5xx). A freshly-started local/self-hosted instance is
// cold — the first /check loads language models and concurrent requests can briefly fail or reset
// connections; a short backoff lets the model finish loading so the retry succeeds. Rate-limit
// (429) is NOT retried here — the sliding-window limiter already governs that.
const REQUEST_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = process.env.VITEST || process.env.NODE_ENV === 'test' ? 0 : 1500;
async function requestWithRetry(text: string, url: string, language: string): Promise<LtRawMatch[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt++) {
    try {
      return await requestLanguageTool(text, url, language);
    } catch (err) {
      lastErr = err;
      if (err instanceof LanguageToolError && err.kind === 'rate_limited') throw err;
      if (attempt < REQUEST_ATTEMPTS - 1) await sleep(RETRY_BACKOFF_MS * (attempt + 1)); // 1.5s, 3s in prod
    }
  }
  throw lastErr;
}

/** Gate (rate limit + global concurrency cap) then issue one LanguageTool request (with retries). */
async function gatedRequest(text: string, url: string, language: string, limited: boolean): Promise<LtRawMatch[]> {
  if (limited) await rateGate(Buffer.byteLength(text, 'utf8'));
  await acquireSlot();
  try {
    return await requestWithRetry(text, url, language);
  } finally {
    releaseSlot();
  }
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]!);
  });
  await Promise.all(runners);
}

async function requestLanguageTool(text: string, url: string, language: string): Promise<LtRawMatch[]> {
  const params: Record<string, string> = { text, language, level: LT_LEVEL };
  if (language === 'auto') params.preferredVariants = PREFERRED_VARIANTS;
  const body = new URLSearchParams(params);
  // A self-hosted / local container is cold on the first checks (it loads language models on
  // demand), so give it a much longer timeout than the public API to avoid spurious "unreachable".
  const timeoutMs = url.includes('languagetool.org') ? 20_000 : 60_000;
  let resp: Response;
  try {
    resp = await fetch(`${url}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
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

/** Whether a rule id is a spelling/typo rule (vs. a grammar/style rule). Spelling rule ids are
 *  LANGUAGE-DEPENDENT — the same name is `GERMAN_SPELLER_RULE` when a field reads as German,
 *  `MORFOLOGIK_RULE_IT_IT` when auto-detected as Italian, `HUNSPELL_RULE` elsewhere — which is why
 *  spelling suppression must key on the matched TOKEN, not the (volatile) rule id. */
function isSpellingRuleId(ruleId: string): boolean {
  return /^(GERMAN_SPELLER_RULE|HUNSPELL_RULE|MORFOLOGIK_RULE)/i.test(ruleId);
}

/** Levenshtein distance, bounded: returns early as soon as it provably exceeds `max`. */
function levenshtein(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // whole row already past the budget — bail
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Heuristic: is this flagged token a likely proper NAME (person / band / place / title) rather
 * than a typo? True only when the token starts with an uppercase letter AND LanguageTool offers
 * no *close* correction for it. Genuine typos of real words always come with a near suggestion
 * (edit distance ≤ 1), so they are NOT treated as names and stay flagged; unknown names — for
 * which the checker has no near dictionary word — are skipped. German capitalizes every noun, so
 * capitalization alone can't separate names from nouns; the "no close fix" test is what does.
 */
function looksLikeProperName(token: string, replacements: string[]): boolean {
  const t = token.normalize('NFC').trim();
  const first = t.charAt(0);
  // Must start with an uppercase LETTER (umlauts included). Numbers / lowercase → not a name.
  if (!first || first === first.toLocaleLowerCase('de')) return false;
  const norm = t.toLowerCase();
  for (const r of replacements) {
    const rn = r.normalize('NFC').toLowerCase().trim();
    if (rn === norm) continue;            // casing-only suggestion is not a "fix"
    if (levenshtein(rn, norm, 1) <= 1) return false; // a close typo correction exists → keep flag
  }
  return true;                            // no close fix → treat as a name, skip
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
// v2: the `auto` path changed from "de-DE+en-US over flagged fields, pick fewer-errors language" to
// "auto pass-1, then drop spelling matches whose token en-US considers valid English". Old cached
// results would otherwise keep serving the previous (false-positive-heavy) verdicts → bump to discard.
const CACHE_VERSION = 2;
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
  managedLanguageToolUrl = null;
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
  const isPublicApi = url.includes('languagetool.org');
  const chunkLimit = opts.chunkLimit ?? (isPublicApi ? DEFAULT_CHUNK_LIMIT : LOCAL_CHUNK_LIMIT);
  // requestGapMs===0 force-disables the limiter (tests + self-hosted overrides); the public API
  // uses the sliding window. Requests run concurrently in both cases — the window caps the rate.
  const limited = isPublicApi && (opts.requestGapMs ?? 1) !== 0;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);

  await ensureCacheLoaded();

  const allowedSet = new Set(config.allowedWords.map(normalizeAllowedWord));
  const ignoredSet = new Set(config.ignoredMatches);
  // Spelling suppression must be language-INDEPENDENT. A name flagged today as GERMAN_SPELLER_RULE
  // may have been flagged-and-ignored earlier as e.g. MORFOLOGIK_RULE_IT_IT (auto-detected Italian);
  // that fingerprint no longer matches once detection flips to German. So treat the TOKEN of every
  // spelling-type ignored fingerprint like an allowed word — restoring those manual ignores across
  // LanguageTool's language-detection changes. (Grammar ignores still match by exact fingerprint.)
  const spellingAllowed = new Set(allowedSet);
  for (const fp of config.ignoredMatches) {
    const sep = fp.indexOf('::');
    if (sep < 0) continue;
    if (isSpellingRuleId(fp.slice(0, sep))) {
      const token = fp.slice(sep + 2); // already NFC-lowercased-trimmed by spellMatchFingerprint
      if (token) spellingAllowed.add(token);
    }
  }

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
      // Pass 1 — ONE batched `auto` pass over ALL fields. Cheap (LanguageTool detects the dominant
      // language once and checks efficiently); for a German show this is the German truth. English
      // content (answers, embedded titles) gets German matches whose flagged tokens are really
      // valid English words — pass 2 strips those.
      const candidate = new Map<string, LocalMatch[]>();
      await pool(chunks, concurrency, async (chunk) => {
        const raw = await gatedRequest(chunk.concat, url, 'auto', limited);
        for (const [k, arr] of mapRawToSegments(chunk, raw)) candidate.set(k, arr);
      });
      // Pass 2 — strip ENGLISH false-positives. Collect every DISTINCT token pass-1 flagged as a
      // misspelling and re-check just those tokens (not the full fields) in `en-US`. A real German
      // typo is foreign to English too, so en-US flags it → keep; an English word ("love", "Knight")
      // is valid English, so en-US does NOT flag it → drop. This is cheap (a handful of short words,
      // one request) — far faster than running the slow English speller over the whole German show.
      const tokenOf = (seg: SpellSegmentInput, m: LocalMatch) =>
        normalizeAllowedWord(seg.text.slice(m.offset, m.offset + m.length));
      const flaggedTokens = new Map<string, string>(); // normalized → original casing (for the en-US request)
      for (const seg of uncached) {
        for (const m of candidate.get(seg.key) ?? []) {
          if (!isSpellingMatch(m)) continue;
          const norm = tokenOf(seg, m);
          if (norm && !flaggedTokens.has(norm)) flaggedTokens.set(norm, seg.text.slice(m.offset, m.offset + m.length));
        }
      }
      const englishClean = new Set<string>(); // tokens en-US treats as valid English (no spelling flag)
      if (flaggedTokens.size > 0) {
        const tokenSegs = [...flaggedTokens.entries()].map(([norm, orig]) => ({ key: norm, text: orig }));
        const tChunks = packChunks(tokenSegs, chunkLimit);
        await pool(tChunks, concurrency, async (chunk) => {
          const raw = await gatedRequest(chunk.concat, url, 'en-US', limited);
          const mapped = mapRawToSegments(chunk, raw);
          for (const e of chunk.entries) {
            if (!(mapped.get(e.key) ?? []).some(isSpellingMatch)) englishClean.add(e.key); // en-US didn't flag → English
          }
        });
      }
      // Reconcile: keep grammar matches and German spelling matches whose token en-US ALSO flags;
      // drop spelling matches on english-clean tokens.
      for (const seg of uncached) {
        const kept = (candidate.get(seg.key) ?? []).filter(m => !isSpellingMatch(m) || !englishClean.has(tokenOf(seg, m)));
        unfiltered.set(seg.key, kept);
      }
    }
    // Cache every uncached field's computed result.
    for (const seg of uncached) cacheSet(cacheKeyFor(language, seg.text), unfiltered.get(seg.key) ?? []);
  }

  // Apply the allowlist at read time and assemble the response.
  return segments.map(s => {
    const locals = unfiltered.get(s.key) ?? [];
    const matches = locals.filter(lm => {
      const matched = s.text.slice(lm.offset, lm.offset + lm.length);
      if (isSpellingMatch(lm) && spellingAllowed.has(normalizeAllowedWord(matched))) return false;
      if (ignoredSet.has(lm.fingerprint)) return false;
      if (isSpellingMatch(lm) && config.skipNames && looksLikeProperName(matched, lm.replacements)) return false;
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
