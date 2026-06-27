/**
 * Deterministic 32-bit PRNG (mulberry32). Given the same seed it always yields
 * the same sequence — used to keep a randomized question order stable across
 * live re-fetches (a content edit must not re-shuffle the playthrough).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Randomizes questions while preserving the first element (example question).
 * If shouldRandomize is false or questions have ≤1 items, returns a copy unchanged.
 * If limit is provided, only that many questions (after the example) are returned.
 * When randomized, a random subset is picked; when not, the first `limit` are taken.
 *
 * Pass a `seed` to make the shuffle deterministic: the permutation then depends
 * only on (seed, array length), not on object identity, so editing a question's
 * content (length unchanged) keeps every question at its existing position.
 * Without a seed it falls back to `Math.random()` (fresh order each call).
 */
export function randomizeQuestions<T extends { disabled?: boolean }>(questions: T[], shouldRandomize?: boolean, limit?: number, seed?: number): T[] {
  const qs = [...questions];
  if (qs.length <= 1) return qs;

  const first = qs[0]!;
  let rest = qs.slice(1).filter(q => !q.disabled);

  if (shouldRandomize) {
    const rand = seed !== undefined ? mulberry32(seed) : Math.random;
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
  }

  if (limit !== undefined && limit > 0 && limit < rest.length) {
    rest = rest.slice(0, limit);
  }

  return [first, ...rest];
}

/**
 * Formats a number with dot-separated thousands (German locale).
 * e.g. 1234567 → "1.234.567"
 */
export function formatNumber(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
