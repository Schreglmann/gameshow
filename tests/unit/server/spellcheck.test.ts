import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkSegments, getRateLimitStatus, LanguageToolError, _resetSpellcheckState } from '../../../server/spellcheck.js';
import { spellMatchFingerprint } from '../../../src/utils/spellcheckFingerprint.js';
import type { SpellcheckConfig } from '../../../server/spellcheck-allowlist.js';

const EMPTY_CONFIG: SpellcheckConfig = { version: 1, enabled: true, allowedWords: [], ignoredMatches: [] };
const LOCAL_URL = 'http://localhost:8081';
const OPTS = { requestGapMs: 0, url: LOCAL_URL } as const;

afterEach(() => {
  vi.unstubAllGlobals();
  _resetSpellcheckState(); // clear the response cache between tests
});

/** Stub fetch returning matches keyed by the request's `text` field; optionally capture bodies. */
function stubByText(byText: Record<string, unknown[]>, capturedBodies?: string[]) {
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const text = new URLSearchParams(String(init?.body ?? '')).get('text') ?? '';
    if (capturedBodies) capturedBodies.push(String(init?.body ?? ''));
    return { ok: true, status: 200, json: async () => ({ matches: byText[text] ?? [] }) } as unknown as Response;
  });
}

const spellingMatch = (offset: number, length: number, ruleId = 'GERMAN_SPELLER_RULE') =>
  ({ offset, length, message: 'm', shortMessage: 's', replacements: [{ value: 'fix' }], rule: { id: ruleId, issueType: 'misspelling', category: { id: 'TYPOS', name: 'Tippfehler' } } });

describe('spellMatchFingerprint', () => {
  it('is stable across casing / whitespace / NFC', () => {
    expect(spellMatchFingerprint('RULE', 'Müller')).toBe(spellMatchFingerprint('RULE', '  müller '));
  });
});

describe('checkSegments — two-pass auto (batch then re-check flagged)', () => {
  it('clears English answers in pass 2 but keeps German typos', async () => {
    const bodies: string[] = [];
    // Pass 1 batches all three; the German-dominant detect flags the English answer too.
    stubByText({
      'Hauptstdat\n\nKnowing You\n\nHallo': [spellingMatch(0, 10), spellingMatch(12, 7)],
      Hauptstdat: [spellingMatch(0, 10)], // German typo, re-checked → still flagged
      'Knowing You': [],                  // English, re-checked as English → clean
    }, bodies);

    const out = await checkSegments(
      [{ key: 'de', text: 'Hauptstdat' }, { key: 'en', text: 'Knowing You' }, { key: 'ok', text: 'Hallo' }],
      EMPTY_CONFIG,
      OPTS,
    );
    const byKey = Object.fromEntries(out.map(r => [r.key, r.matches]));
    expect(byKey.de).toHaveLength(1);
    expect(byKey.de[0]).toMatchObject({ offset: 0, length: 10 });
    expect(byKey.en).toEqual([]); // cleared in pass 2
    expect(byKey.ok).toEqual([]);
    // 1 batched pass-1 request + 2 re-checks (de, en). "Hallo" was clean → not re-checked.
    expect(bodies).toHaveLength(3);
  });

  it('caches per-field results — a second identical check makes no requests', async () => {
    const bodies: string[] = [];
    stubByText({ 'Pariss\n\nHallo': [spellingMatch(0, 6)], Pariss: [spellingMatch(0, 6)] }, bodies);
    const segs = [{ key: 'a', text: 'Pariss' }, { key: 'b', text: 'Hallo' }];
    const first = await checkSegments(segs, EMPTY_CONFIG, OPTS);
    expect(first.find(r => r.key === 'a')?.matches).toHaveLength(1);
    const callsAfterFirst = bodies.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    const second = await checkSegments(segs, EMPTY_CONFIG, OPTS);
    expect(bodies.length).toBe(callsAfterFirst); // no new requests — served from cache
    expect(second.find(r => r.key === 'a')?.matches).toHaveLength(1);
  });

  it('applies the allowlist at read time, so allowing a word affects cached results without a re-fetch', async () => {
    const bodies: string[] = [];
    stubByText({ Pariss: [spellingMatch(0, 6)] }, bodies);
    const segs = [{ key: 'a', text: 'Pariss' }];
    await checkSegments(segs, EMPTY_CONFIG, OPTS);
    const calls = bodies.length;
    const out = await checkSegments(segs, { ...EMPTY_CONFIG, allowedWords: ['pariss'] }, OPTS);
    expect(bodies.length).toBe(calls);     // cache hit, no new request
    expect(out[0].matches).toEqual([]);    // but the now-allowed word is filtered out
  });

  it('makes a single batched request when nothing flags', async () => {
    const bodies: string[] = [];
    stubByText({}, bodies);
    await checkSegments([{ key: 'a', text: 'eins' }, { key: 'b', text: 'zwei' }], EMPTY_CONFIG, OPTS);
    expect(bodies).toHaveLength(1);
    const p = new URLSearchParams(bodies[0]);
    expect(p.get('language')).toBe('auto');
    expect(p.get('preferredVariants')).toBe('de-DE,en-US');
    expect(p.get('text')).toBe('eins\n\nzwei');
  });
});

describe('checkSegments — fixed language (single batched pass)', () => {
  it('does one batched request and no per-field re-check', async () => {
    const bodies: string[] = [];
    stubByText({ 'Pariss\n\nHallo': [spellingMatch(0, 6)] }, bodies);
    const out = await checkSegments([{ key: 'a', text: 'Pariss' }, { key: 'b', text: 'Hallo' }], EMPTY_CONFIG, { ...OPTS, language: 'de-DE' });
    expect(bodies).toHaveLength(1); // no pass 2
    expect(new URLSearchParams(bodies[0]).get('language')).toBe('de-DE');
    expect(new URLSearchParams(bodies[0]).get('preferredVariants')).toBeNull();
    expect(Object.fromEntries(out.map(r => [r.key, r.matches])).a).toHaveLength(1);
  });
});

describe('checkSegments — allowlist filtering', () => {
  it('drops a spelling match whose word is allowlisted (case-insensitive)', async () => {
    stubByText({ Pariss: [spellingMatch(0, 6)] });
    const out = await checkSegments([{ key: 'a', text: 'Pariss' }], { ...EMPTY_CONFIG, allowedWords: ['pariss'] }, { ...OPTS, language: 'de-DE' });
    expect(out[0].matches).toEqual([]);
  });

  it('drops any match whose fingerprint is ignored', async () => {
    stubByText({ Pariss: [{ offset: 0, length: 6, rule: { id: 'GRAMMAR_Y', issueType: 'grammar' } }] });
    const fp = spellMatchFingerprint('GRAMMAR_Y', 'Pariss');
    const out = await checkSegments([{ key: 'a', text: 'Pariss' }], { ...EMPTY_CONFIG, ignoredMatches: [fp] }, { ...OPTS, language: 'de-DE' });
    expect(out[0].matches).toEqual([]);
  });

  it('skips empty / whitespace-only segments (no request) but still returns them', async () => {
    const bodies: string[] = [];
    stubByText({}, bodies);
    const out = await checkSegments([{ key: 'a', text: '   ' }, { key: 'b', text: 'x' }], EMPTY_CONFIG, OPTS);
    expect(bodies).toHaveLength(1); // only the non-empty one batched
    expect(out.find(r => r.key === 'a')?.matches).toEqual([]);
  });
});

describe('sliding-window rate limiter', () => {
  it('is idle after reset', () => {
    _resetSpellcheckState();
    const s = getRateLimitStatus();
    expect(s).toMatchObject({ throttling: false, waiting: 0, retryAfterMs: 0, windowCount: 0 });
    expect(s.windowMax).toBeGreaterThan(0);
  });

  it('records public-API requests in the window but does not throttle a normal burst under the cap', async () => {
    const bodies: string[] = [];
    stubByText({}, bodies); // nothing flags → a single batched pass-1 request
    await checkSegments(
      [{ key: 'a', text: 'eins' }, { key: 'b', text: 'zwei' }],
      EMPTY_CONFIG,
      { url: 'https://api.languagetool.org' }, // public URL → limiter ON (no requestGapMs override)
    );
    expect(bodies).toHaveLength(1);
    const s = getRateLimitStatus();
    expect(s.throttling).toBe(false); // well under the per-minute cap → no waiting
    expect(s.retryAfterMs).toBe(0);
    expect(s.windowCount).toBe(1); // the request was recorded in the sliding window
  });
});

describe('checkSegments — error handling', () => {
  it('maps 429 to rate_limited', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 429, json: async () => ({}) } as unknown as Response));
    await expect(checkSegments([{ key: 'a', text: 'x' }], EMPTY_CONFIG, OPTS)).rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('maps a network reject to unreachable', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED'); });
    await expect(checkSegments([{ key: 'a', text: 'x' }], EMPTY_CONFIG, OPTS)).rejects.toMatchObject({ kind: 'unreachable' });
  });

  it('maps a 500 to bad_status', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response));
    const err = await checkSegments([{ key: 'a', text: 'x' }], EMPTY_CONFIG, OPTS).catch(e => e);
    expect(err).toBeInstanceOf(LanguageToolError);
    expect(err.kind).toBe('bad_status');
  });
});
