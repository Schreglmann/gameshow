import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkSegments, getRateLimitStatus, setManagedLanguageToolUrl, LanguageToolError, _resetSpellcheckState } from '../../../server/spellcheck.js';
import { spellMatchFingerprint } from '../../../src/utils/spellcheckFingerprint.js';
import type { SpellcheckConfig } from '../../../server/spellcheck-allowlist.js';

// skipNames:false here so the existing assertions see unfiltered matches; the name-skip suite
// below opts in explicitly.
const EMPTY_CONFIG: SpellcheckConfig = { version: 1, enabled: true, skipNames: false, allowedWords: [], ignoredMatches: [] };
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

/** Stub fetch keyed by `${language}|${text}` — for the two-pass path (pass-1 de-DE + en-US over tokens). */
function stubByLang(byKey: Record<string, unknown[]>, capturedBodies?: string[]) {
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const p = new URLSearchParams(String(init?.body ?? ''));
    if (capturedBodies) capturedBodies.push(String(init?.body ?? ''));
    return { ok: true, status: 200, json: async () => ({ matches: byKey[`${p.get('language')}|${p.get('text')}`] ?? [] }) } as unknown as Response;
  });
}

const spellingMatch = (offset: number, length: number, ruleId = 'GERMAN_SPELLER_RULE') =>
  ({ offset, length, message: 'm', shortMessage: 's', replacements: [{ value: 'fix' }], rule: { id: ruleId, issueType: 'misspelling', category: { id: 'TYPOS', name: 'Tippfehler' } } });

describe('spellMatchFingerprint', () => {
  it('is stable across casing / whitespace / NFC', () => {
    expect(spellMatchFingerprint('RULE', 'Müller')).toBe(spellMatchFingerprint('RULE', '  müller '));
  });
});

describe('checkSegments — de-DE base: pass-1 de-DE, then en-US over flagged TOKENS (drop English words)', () => {
  it('drops English words/answers (en-US accepts the token) but keeps German typos', async () => {
    const bodies: string[] = [];
    // pass-1 de-DE batches all fields. Offsets in the concat:
    //   "Hauptstdat" 0..10 · "Knowing" 12..19 · "You" 20..23 · "Hallo" 25..30
    const P1 = 'Hauptstdat\n\nKnowing You\n\nHallo';
    // pass-2 en-US over the DISTINCT flagged tokens (insertion order): Hauptstdat, Knowing, You
    const T = 'Hauptstdat\n\nKnowing\n\nYou';
    stubByLang({
      [`de-DE|${P1}`]: [spellingMatch(0, 10), spellingMatch(12, 7), spellingMatch(20, 3)], // de typo + 2 English words
      [`en-US|${T}`]: [spellingMatch(0, 10)], // en flags only "Hauptstdat" (German word); Knowing/You are valid English
    }, bodies);

    const out = await checkSegments(
      [{ key: 'de', text: 'Hauptstdat' }, { key: 'en', text: 'Knowing You' }, { key: 'ok', text: 'Hallo' }],
      EMPTY_CONFIG,
      OPTS,
    );
    const byKey = Object.fromEntries(out.map(r => [r.key, r.matches]));
    expect(byKey.de).toHaveLength(1);            // German typo: en-US flags the token too → kept
    expect(byKey.de[0]).toMatchObject({ offset: 0, length: 10 });
    expect(byKey.en).toEqual([]);                // "Knowing"/"You" valid English → dropped
    expect(byKey.ok).toEqual([]);                // never flagged in pass 1 → clean
    expect(bodies).toHaveLength(2);              // 1 de-DE + 1 en-US (tokens).
    expect(bodies.filter(b => new URLSearchParams(b).get('language') === 'de-DE')).toHaveLength(1);
    expect(bodies.filter(b => new URLSearchParams(b).get('language') === 'en-US')).toHaveLength(1);
  });

  it('drops an embedded English word in a German sentence (en-US accepts the token)', async () => {
    const P1 = 'Sie sang love laut.'; // "love" at offset 9
    stubByLang({
      [`de-DE|${P1}`]: [spellingMatch(9, 4)], // German pass-1 flags "love"
      'en-US|love': [],                        // en-US: "love" is valid English → no spelling match
    });
    const out = await checkSegments([{ key: 'a', text: P1 }], EMPTY_CONFIG, OPTS);
    expect(out[0].matches).toEqual([]); // embedded English word stripped
  });

  it('caches per-field results — a second identical check makes no requests', async () => {
    const bodies: string[] = [];
    stubByLang({
      'de-DE|Pariss\n\nHallo': [spellingMatch(0, 6)], // pass 1 flags only "Pariss"
      'en-US|Pariss': [spellingMatch(0, 6)],          // en flags it too (foreign) → kept
    }, bodies);
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
    stubByLang({ 'de-DE|Pariss': [spellingMatch(0, 6)], 'en-US|Pariss': [spellingMatch(0, 6)] }, bodies);
    const segs = [{ key: 'a', text: 'Pariss' }];
    await checkSegments(segs, EMPTY_CONFIG, OPTS);
    const calls = bodies.length;
    const out = await checkSegments(segs, { ...EMPTY_CONFIG, allowedWords: ['pariss'] }, OPTS);
    expect(bodies.length).toBe(calls);     // cache hit, no new request
    expect(out[0].matches).toEqual([]);    // but the now-allowed word is filtered out
  });

  it('makes a single de-DE request when nothing flags (no pass 2)', async () => {
    const bodies: string[] = [];
    stubByLang({}, bodies);
    const out = await checkSegments([{ key: 'a', text: 'eins' }, { key: 'b', text: 'zwei' }], EMPTY_CONFIG, OPTS);
    expect(bodies).toHaveLength(1); // pass-1 de-DE only; nothing flagged → no pass-2
    const p = new URLSearchParams(bodies[0]);
    expect(p.get('language')).toBe('de-DE'); // German base — no auto-detection (avoids misflagging German)
    expect(p.get('preferredVariants')).toBeNull(); // only set for auto
    expect(p.get('text')).toBe('eins\n\nzwei');
    expect(out.every(r => r.matches.length === 0)).toBe(true);
  });

  it('opt-in language=auto still runs the two-pass path with preferredVariants', async () => {
    const bodies: string[] = [];
    stubByLang({}, bodies);
    await checkSegments([{ key: 'a', text: 'eins' }], EMPTY_CONFIG, { ...OPTS, language: 'auto' });
    expect(bodies).toHaveLength(1);
    const p = new URLSearchParams(bodies[0]);
    expect(p.get('language')).toBe('auto');
    expect(p.get('preferredVariants')).toBe('de-DE,en-US');
  });
});

describe('checkSegments — language-independent spelling suppression', () => {
  it('suppresses a spelling match whose token was ignored under a now-stale language ruleId', async () => {
    // Field once auto-detected as Italian → user ignored MORFOLOGIK_RULE_IT_IT::stefani. Detection
    // now flips to German (GERMAN_SPELLER_RULE) — the token-based spelling ignore still suppresses it.
    stubByLang({
      'de-DE|Stefani': [spellingMatch(0, 7, 'GERMAN_SPELLER_RULE')],
      'en-US|Stefani': [spellingMatch(0, 7, 'MORFOLOGIK_RULE_EN_US')], // en flags it too → not "English-clean"
    });
    const out = await checkSegments([{ key: 'a', text: 'Stefani' }],
      { ...EMPTY_CONFIG, ignoredMatches: ['MORFOLOGIK_RULE_IT_IT::stefani'] }, OPTS);
    expect(out[0].matches).toEqual([]);
  });

  it('does not let a GRAMMAR ignore token become a blanket spelling allow for the same word', async () => {
    // DE_CASE is a grammar rule → its token must NOT suppress a real spelling match on "Berlin".
    stubByLang({
      'de-DE|Berlin': [spellingMatch(0, 6, 'GERMAN_SPELLER_RULE')],
      'en-US|Berlin': [spellingMatch(0, 6, 'MORFOLOGIK_RULE_EN_US')],
    });
    const out = await checkSegments([{ key: 'a', text: 'Berlin' }],
      { ...EMPTY_CONFIG, ignoredMatches: ['DE_CASE::berlin'] }, OPTS);
    expect(out[0].matches).toHaveLength(1); // grammar ignore ≠ spelling allow → still flagged
  });
});

describe('checkSegments — fixed non-German language (single batched pass)', () => {
  it('does one batched request and no en-US token re-check', async () => {
    const bodies: string[] = [];
    // A fixed non-German language skips the German two-pass path (no en-US strip).
    stubByText({ 'Pariss\n\nHallo': [spellingMatch(0, 6)] }, bodies);
    const out = await checkSegments([{ key: 'a', text: 'Pariss' }, { key: 'b', text: 'Hallo' }], EMPTY_CONFIG, { ...OPTS, language: 'fr-FR' });
    expect(bodies).toHaveLength(1); // no pass 2
    expect(new URLSearchParams(bodies[0]).get('language')).toBe('fr-FR');
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

  it('skips empty / whitespace-only segments (only the non-empty one is checked)', async () => {
    const bodies: string[] = [];
    stubByLang({}, bodies);
    const out = await checkSegments([{ key: 'a', text: '   ' }, { key: 'b', text: 'x' }], EMPTY_CONFIG, OPTS);
    expect(bodies).toHaveLength(1); // only 'x' batched into pass-1 de-DE; nothing flags → no pass-2
    expect(new URLSearchParams(bodies[0]).get('text')).toBe('x');
    expect(out.find(r => r.key === 'a')?.matches).toEqual([]);
  });
});

describe('checkSegments — skipNames (proper-name heuristic)', () => {
  const named = (offset: number, length: number, replacements: { value: string }[], ruleId = 'GERMAN_SPELLER_RULE') =>
    ({ offset, length, message: 'm', shortMessage: 's', replacements, rule: { id: ruleId, issueType: 'misspelling', category: { id: 'TYPOS', name: 'Tippfehler' } } });

  it('skips a capitalized word with no close correction when skipNames is on', async () => {
    stubByText({ Beethoven: [named(0, 9, [])] });
    const out = await checkSegments([{ key: 'a', text: 'Beethoven' }], { ...EMPTY_CONFIG, skipNames: true }, { ...OPTS, language: 'de-DE' });
    expect(out[0].matches).toEqual([]);
  });

  it('keeps that same word when skipNames is off', async () => {
    stubByText({ Beethoven: [named(0, 9, [])] });
    const out = await checkSegments([{ key: 'a', text: 'Beethoven' }], { ...EMPTY_CONFIG, skipNames: false }, { ...OPTS, language: 'de-DE' });
    expect(out[0].matches).toHaveLength(1);
  });

  it('still flags a real German typo (a close correction exists) even with skipNames on', async () => {
    // "Hauptstdt" → suggestion "Hauptstadt" is edit distance 1, so it is NOT treated as a name.
    stubByText({ Hauptstdt: [named(0, 9, [{ value: 'Hauptstadt' }])] });
    const out = await checkSegments([{ key: 'a', text: 'Hauptstdt' }], { ...EMPTY_CONFIG, skipNames: true }, { ...OPTS, language: 'de-DE' });
    expect(out[0].matches).toHaveLength(1);
  });

  it('does not skip a lowercase unknown word (not name-shaped) even with skipNames on', async () => {
    stubByText({ flumpx: [named(0, 6, [])] });
    const out = await checkSegments([{ key: 'a', text: 'flumpx' }], { ...EMPTY_CONFIG, skipNames: true }, { ...OPTS, language: 'de-DE' });
    expect(out[0].matches).toHaveLength(1);
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
    stubByLang({}, bodies); // nothing flags → pass-1 de-DE only = 1 request
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

describe('setManagedLanguageToolUrl — routing precedence', () => {
  it('routes checkSegments at the managed URL (no opts.url) and runs unthrottled (local, not public)', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ matches: [] }) } as unknown as Response;
    });
    setManagedLanguageToolUrl('http://localhost:8010');
    await checkSegments([{ key: 'a', text: 'eins' }], EMPTY_CONFIG, {}); // no opts.url, no gap override
    expect(urls[0]).toBe('http://localhost:8010/v2/check');
    expect(getRateLimitStatus().windowCount).toBe(0); // local URL ⇒ not public ⇒ no rate window consumed
  });

  it('reverts to the public API when the managed URL is cleared', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ matches: [] }) } as unknown as Response;
    });
    setManagedLanguageToolUrl(null);
    await checkSegments([{ key: 'a', text: 'eins' }], EMPTY_CONFIG, { requestGapMs: 0 });
    expect(urls[0]).toBe('https://api.languagetool.org/v2/check');
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
