import { describe, it, expect } from 'vitest';
import { normalize, levenshtein, similarity, findSpells, type SpellEntry, type WhisperWord } from '../../../scripts/lib/whisper-match';

const DICT: SpellEntry[] = [
  { canonical: 'Wingardium Leviosa', aliases: ['wingardium leviosa', 'vingardium liviosa'], movies: [1] },
  { canonical: 'Expelliarmus', aliases: ['expelliarmus', 'expelliamus'], movies: [2, 3] },
  { canonical: 'Lumos', aliases: ['lumos'], movies: [1] },
  { canonical: 'Avada Kedavra', aliases: ['avada kedavra'], movies: [4] },
];

function w(word: string, start: number, end: number): WhisperWord {
  return { word, start, end };
}

describe('normalize', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalize("Wingardium! Leviosa.")).toBe('wingardium leviosa');
  });
  it('preserves german umlauts', () => {
    expect(normalize('Großmütter')).toBe('großmütter');
  });
  it('collapses whitespace', () => {
    expect(normalize('  Hello   World  ')).toBe('hello world');
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('expelliarmus', 'expelliarmus')).toBe(0);
  });
  it('returns 1 for a single edit', () => {
    expect(levenshtein('expelliarmus', 'expelliamus')).toBe(1); // missing 'r'
  });
  it('handles empty strings', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });
});

describe('similarity', () => {
  it('identical strings score 1', () => {
    expect(similarity('expelliarmus', 'expelliarmus')).toBe(1);
  });
  it('one-character variant scores high', () => {
    const s = similarity('expelliamus', 'expelliarmus');
    expect(s).toBeGreaterThan(0.9);
  });
  it('completely different strings score low', () => {
    expect(similarity('cat', 'expelliarmus')).toBeLessThan(0.5);
  });
  it('handles empty input', () => {
    expect(similarity('', '')).toBe(1);
    expect(similarity('', 'abc')).toBe(0);
  });
});

describe('findSpells', () => {
  it('finds a single-word spell with clean transcription', () => {
    const words = [
      w('Harry', 1, 1.5),
      w('shouted', 1.5, 2),
      w('Expelliarmus', 2, 2.7),
      w('and', 2.7, 3),
    ];
    const matches = findSpells(words, DICT);
    expect(matches).toHaveLength(1);
    expect(matches[0].spell.canonical).toBe('Expelliarmus');
    expect(matches[0].wordStart).toBe(2);
    expect(matches[0].wordEnd).toBe(2.7);
    expect(matches[0].confidence).toBeGreaterThan(0.95);
  });

  it('finds a multi-word spell across consecutive tokens', () => {
    const words = [
      w('Hermione', 0, 1),
      w('cried', 1, 1.5),
      w('Wingardium', 1.5, 2.2),
      w('Leviosa', 2.2, 3),
      w('and', 3, 3.3),
    ];
    const matches = findSpells(words, DICT);
    const spell = matches.find(m => m.spell.canonical === 'Wingardium Leviosa');
    expect(spell).toBeDefined();
    expect(spell!.wordStart).toBe(1.5);
    expect(spell!.wordEnd).toBe(3);
  });

  it('matches a token-split spell ("ex peli armus" → Expelliarmus)', () => {
    const words = [
      w('Now', 0, 0.5),
      w('ex', 1, 1.2),
      w('peli', 1.2, 1.5),
      w('armus', 1.5, 1.9),
      w('then', 1.9, 2.2),
    ];
    const matches = findSpells(words, DICT);
    const spell = matches.find(m => m.spell.canonical === 'Expelliarmus');
    expect(spell).toBeDefined();
    expect(spell!.wordStart).toBe(1);
    expect(spell!.wordEnd).toBe(1.9);
  });

  it('matches an alias variant ("vingardium liviosa")', () => {
    const words = [
      w('Vingardium', 0, 0.5),
      w('Liviosa', 0.5, 1.2),
    ];
    const matches = findSpells(words, DICT);
    expect(matches).toHaveLength(1);
    expect(matches[0].spell.canonical).toBe('Wingardium Leviosa');
  });

  it('deduplicates matches within a 10s window, keeping the highest confidence', () => {
    // First mention scored against a word that's NOT in the alias list — yields a
    // fuzzy < 1.0 score. The second (exact) match should win the dedup.
    const words = [
      w('Expelliarmuss', 0, 0.7),  // extra trailing 's' — not an alias, ~0.92 similarity
      w('Expelliarmus', 3, 3.7),   // exact — 1.0 similarity
    ];
    const matches = findSpells(words, DICT);
    const exp = matches.filter(m => m.spell.canonical === 'Expelliarmus');
    expect(exp).toHaveLength(1);
    expect(exp[0].wordStart).toBe(3);
  });

  it('keeps the same spell at distinct timestamps when far apart', () => {
    const words = [
      w('Expelliarmus', 10, 10.7),
      // 30s later — different casting — both should be kept
      w('Expelliarmus', 40, 40.7),
    ];
    const matches = findSpells(words, DICT);
    const exp = matches.filter(m => m.spell.canonical === 'Expelliarmus');
    expect(exp).toHaveLength(2);
  });

  it('does NOT match unrelated dialogue', () => {
    const words = [
      w('the', 0, 0.2),
      w('weather', 0.2, 0.6),
      w('is', 0.6, 0.7),
      w('lovely', 0.7, 1),
    ];
    expect(findSpells(words, DICT)).toHaveLength(0);
  });

  it('returns matches sorted by start time', () => {
    const words = [
      w('Lumos', 5, 5.5),
      w('Avada', 1, 1.5),
      w('Kedavra', 1.5, 2.2),
      w('Lumos', 8, 8.5),  // far enough to not dedupe with the first Lumos
    ];
    const matches = findSpells(words, DICT);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i].wordStart).toBeGreaterThanOrEqual(matches[i - 1].wordStart);
    }
  });

  it('flags low-confidence matches via the confidence field but still includes them', () => {
    // "expelliarms" — missing two letters, similarity ~0.83
    const words = [w('Expelliarms', 0, 0.7)];
    const matches = findSpells(words, DICT);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // Caller can decide: low-confidence (< 0.80) goes to review log, high-confidence is kept
  });

  it('skips spells flagged commonEnglish (e.g. "Point Me")', () => {
    const dict: SpellEntry[] = [
      { canonical: 'Point Me', aliases: ['point me'], movies: [4], commonEnglish: true },
      { canonical: 'Expelliarmus', aliases: ['expelliarmus'], movies: [4] },
    ];
    const words = [
      w('Could', 0, 0.3),
      w('you', 0.3, 0.4),
      w('point', 0.4, 0.6),
      w('me', 0.6, 0.7),
      w('to', 0.7, 0.8),
      w('Expelliarmus', 1.0, 1.7),
    ];
    const matches = findSpells(words, dict);
    expect(matches.find(m => m.spell.canonical === 'Point Me')).toBeUndefined();
    expect(matches.find(m => m.spell.canonical === 'Expelliarmus')).toBeDefined();
  });

  it('movieIndex filter drops spells whose movies list excludes the current movie', () => {
    const dict: SpellEntry[] = [
      // Sectumsempra only appears in movie 6
      { canonical: 'Sectumsempra', aliases: ['sectumsempra'], movies: [6] },
      // Lumos appears in many
      { canonical: 'Lumos', aliases: ['lumos'], movies: [1, 3, 4, 5, 6, 7, 8] },
      // No movies field — should NOT be filtered
      { canonical: 'Whatever', aliases: ['whatever'] },
    ];
    const words = [
      w('Sectumsempra', 0, 0.7),
      w('Lumos', 1, 1.5),
      w('Whatever', 2, 2.5),
    ];
    // Processing movie 1 — Sectumsempra should be filtered out, Lumos + Whatever kept
    const matches = findSpells(words, dict, { movieIndex: 1 });
    expect(matches.find(m => m.spell.canonical === 'Sectumsempra')).toBeUndefined();
    expect(matches.find(m => m.spell.canonical === 'Lumos')).toBeDefined();
    expect(matches.find(m => m.spell.canonical === 'Whatever')).toBeDefined();
  });

  it('movieIndex filter keeps the spell when movies list includes that index', () => {
    const dict: SpellEntry[] = [
      { canonical: 'Sectumsempra', aliases: ['sectumsempra'], movies: [6] },
    ];
    const words = [w('Sectumsempra', 0, 0.7)];
    const matches = findSpells(words, dict, { movieIndex: 6 });
    expect(matches).toHaveLength(1);
    expect(matches[0].spell.canonical).toBe('Sectumsempra');
  });

  it('preserves germanName on matched spells so the generator can render bilingual answers', () => {
    const dict: SpellEntry[] = [
      { canonical: 'Wingardium Leviosa', germanName: 'Schwebezauber', aliases: ['wingardium leviosa'], movies: [1] },
    ];
    const words = [w('Wingardium', 0, 0.5), w('Leviosa', 0.5, 1.0)];
    const matches = findSpells(words, dict, { movieIndex: 1 });
    expect(matches).toHaveLength(1);
    expect(matches[0].spell.germanName).toBe('Schwebezauber');
  });
});
