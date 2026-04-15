/**
 * Fuzzy matcher for finding spell words in a Whisper transcript.
 *
 * The Whisper transcript output is a stream of word-timestamped tokens. Latin spell words
 * spoken inside English (or German) dialogue often get split across tokens or transcribed
 * phonetically:
 *
 *   "Expelliarmus"          → ["expelliarmus"]                (clean case)
 *   "Expelliarmus"          → ["ex", "peli", "armus"]         (split)
 *   "Wingardium Leviosa"    → ["wingardium", "leviosa"]       (clean two-word)
 *   "Wingardium Leviosa"    → ["wing", "gardium", "leviosa"]  (split first word)
 *   "Avada Kedavra"         → ["avada", "kedavra"]
 *   "Vingardium Liviosa"    → ["vingardium", "liviosa"]       (Ron's mispronunciation)
 *
 * Strategy: a sliding window of 1-4 adjacent tokens is concatenated and compared against the
 * canonical name (and any aliases) using normalized Levenshtein distance. We compare both the
 * raw concatenation ("ex peli armus") AND the spaces-stripped form ("expeliarmus") to handle
 * the splitting case. Threshold ≥ 0.80 is high confidence, 0.70-0.80 is flagged for review.
 *
 * After matches are collected, duplicates within a 10-second window of the same canonical are
 * collapsed to the highest-confidence one — Whisper sometimes lists the same word in slightly
 * different positions across overlapping segments.
 */

export interface SpellEntry {
  canonical: string;
  aliases: string[];
  /** Alternative *spoken* name used in the other-language dub of this movie, when it
   *  differs from the canonical form. When set, `generate-hp-spells.ts` joins both into
   *  the emitted `answer` field as `"<canonical> / <germanName>"`.
   *
   *  CRITICAL: only populate this with what the characters actually *say* in the dub.
   *  Do NOT use a descriptive translation of what the spell does. For example:
   *    - Wingardium Leviosa: the German dub also says "Wingardium Leviosa" — do NOT
   *      add "Schwebezauber" here. That's a description, nobody in the movie says it.
   *    - If a dub literally pronounces the incantation differently, that's what goes
   *      here.
   *  Most HP spells use the Latin incantation in both language tracks, so this field
   *  is usually omitted. */
  germanName?: string;
  /** Movies (1-8) the spell is known to appear in. When `findSpells` is called with
   *  `movieIndex`, entries whose movies list does not include that index are skipped —
   *  eliminates a large class of false positives like "Point Me" matching outside
   *  Goblet of Fire. Entries without `movies` are considered "could appear anywhere". */
  movies?: number[];
  /** True for spells whose canonical/alias forms are too common in normal speech (e.g.
   *  hypothetically "Pack" if it were ever a spell) to safely auto-detect from ASR even
   *  inside the right movie. `findSpells` skips them entirely. The operator can still
   *  add them manually via the admin marker editor. */
  commonEnglish?: boolean;
}

export interface WhisperWord {
  word: string;
  /** Seconds, absolute to the start of the audio file. */
  start: number;
  end: number;
}

export interface SpellMatch {
  spell: SpellEntry;
  wordStart: number;
  wordEnd: number;
  /** Similarity 0..1; ≥0.80 high-confidence, 0.70-0.80 flagged. */
  confidence: number;
  /** The actual concatenated text Whisper produced (for the review log). */
  whisperText: string;
}

const HIGH_CONFIDENCE = 0.80;
const LOW_CONFIDENCE = 0.70;
const MAX_WINDOW = 4;
const DEDUPE_WINDOW_SECONDS = 10;

/** Lowercase, strip punctuation/digits, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-zäöüß\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Standard Levenshtein distance with O(min(a,b)) memory. Iterative + single-row buffer so
 * we don't blow the stack on long strings.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Ensure a is the shorter one — keeps the row buffer minimal
  if (a.length > b.length) { const t = a; a = b; b = t; }
  const prev = new Array(a.length + 1);
  const curr = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;
  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,        // insertion
        prev[i] + 1,            // deletion
        prev[i - 1] + cost,     // substitution
      );
    }
    for (let i = 0; i <= a.length; i++) prev[i] = curr[i];
  }
  return prev[a.length];
}

export function similarity(candidate: string, target: string): number {
  if (!candidate && !target) return 1;
  if (!candidate || !target) return 0;
  const dist = levenshtein(candidate, target);
  return 1 - dist / Math.max(candidate.length, target.length);
}

/**
 * Best similarity score between a Whisper window and a single spell, comparing against:
 *   - canonical AND each alias
 *   - both the raw concatenation and the spaces-stripped form
 *
 * Returns the higher of the two comparison forms — captures both clean speech and split tokens.
 */
function scoreSpell(window: string, spell: SpellEntry): number {
  const noSpace = window.replace(/\s+/g, '');
  const candidates = [normalize(spell.canonical), ...spell.aliases.map(normalize)];
  let best = 0;
  for (const c of candidates) {
    const cNoSpace = c.replace(/\s+/g, '');
    const a = similarity(window, c);
    const b = similarity(noSpace, cNoSpace);
    if (a > best) best = a;
    if (b > best) best = b;
  }
  return best;
}

export interface FindOptions {
  highConfidence?: number;
  lowConfidence?: number;
  maxWindow?: number;
  dedupeWindowSeconds?: number;
  /**
   * When set, only spells whose `movies` field includes this number are considered.
   * Spells without a `movies` field are always kept. This filters a large class of
   * false positives — e.g. "Point Me" only legitimately appears in Goblet of Fire,
   * so any match in the other 7 films is automatically a wrong guess.
   */
  movieIndex?: number;
  /**
   * Called periodically (roughly every 500 words + once at completion) during the scan so
   * the caller can render a progress bar. `scanned` is the current word index, `total` is
   * the full word count. Optional — tests and silent callers can omit it.
   */
  onProgress?: (scanned: number, total: number) => void;
}

/**
 * Scan a Whisper word list for any spells in the dictionary. Returns deduplicated matches,
 * sorted by start time. Low-confidence matches (between thresholds) are included so the
 * caller can decide whether to flag them — see `confidence` on each result.
 */
export function findSpells(
  words: WhisperWord[],
  dictionary: SpellEntry[],
  opts: FindOptions = {},
): SpellMatch[] {
  const high = opts.highConfidence ?? HIGH_CONFIDENCE;
  const low = opts.lowConfidence ?? LOW_CONFIDENCE;
  const maxWindow = opts.maxWindow ?? MAX_WINDOW;
  const dedupe = opts.dedupeWindowSeconds ?? DEDUPE_WINDOW_SECONDS;
  const onProgress = opts.onProgress;

  // Pre-filter the dictionary once: drop commonEnglish spells (too risky for ASR auto-
  // detection) and spells not in the requested movie. The inner loop runs millions of
  // times for a long transcript, so doing this filter once up-front matters.
  const filtered = dictionary.filter(s => {
    if (s.commonEnglish) return false;
    if (opts.movieIndex !== undefined && s.movies && !s.movies.includes(opts.movieIndex)) return false;
    return true;
  });

  const all: SpellMatch[] = [];

  // Pre-normalise words so we don't re-normalise inside the inner loop
  const norms = words.map(w => normalize(w.word));

  for (let i = 0; i < words.length; i++) {
    if (onProgress && (i % 500 === 0)) onProgress(i, words.length);
    for (let size = 1; size <= maxWindow && i + size <= words.length; size++) {
      const slice = norms.slice(i, i + size).filter(s => s.length > 0).join(' ').trim();
      if (!slice) continue;
      // Skip windows that obviously can't be a spell (too short — most spells ≥4 chars
      // even after stripping spaces)
      if (slice.replace(/\s+/g, '').length < 4) continue;

      let bestSpell: SpellEntry | null = null;
      let bestScore = 0;
      for (const spell of filtered) {
        const s = scoreSpell(slice, spell);
        if (s > bestScore) { bestScore = s; bestSpell = spell; }
      }
      if (bestSpell && bestScore >= low) {
        all.push({
          spell: bestSpell,
          wordStart: words[i].start,
          wordEnd: words[i + size - 1].end,
          confidence: bestScore,
          whisperText: slice,
        });
        // We could break here on a high-confidence match, but keeping all candidates lets
        // the deduper pick the best — sometimes a 2-word window scores a tiny bit better
        // than the 3-word window for the same spell.
      }
    }
  }

  if (onProgress) onProgress(words.length, words.length);

  // Deduplicate: for each canonical spell, keep the highest-scoring match within any
  // 10-second sliding window. A given spell legitimately cast twice in a movie 30 minutes
  // apart should produce two entries.
  return dedupeMatches(all, dedupe).filter(m => m.confidence >= low);
}

function dedupeMatches(matches: SpellMatch[], windowSec: number): SpellMatch[] {
  if (matches.length === 0) return [];
  matches.sort((a, b) => a.wordStart - b.wordStart);
  const result: SpellMatch[] = [];
  // For each canonical, the latest accepted timestamp
  const lastAccepted = new Map<string, SpellMatch>();
  for (const m of matches) {
    const key = m.spell.canonical;
    const prev = lastAccepted.get(key);
    if (prev && m.wordStart - prev.wordStart < windowSec) {
      // Same spell within the dedupe window — keep the higher-confidence one
      if (m.confidence > prev.confidence) {
        // Replace the previous in result
        const idx = result.indexOf(prev);
        if (idx >= 0) result[idx] = m;
        lastAccepted.set(key, m);
      }
      continue;
    }
    result.push(m);
    lastAccepted.set(key, m);
  }
  return result;
}

export const THRESHOLDS = { HIGH_CONFIDENCE, LOW_CONFIDENCE };
