/**
 * Randomizes questions while preserving the first element (example question).
 * If shouldRandomize is false or questions have ≤1 items, returns a copy unchanged.
 * If limit is provided, only that many questions (after the example) are returned.
 * When randomized, a random subset is picked; when not, the first `limit` are taken.
 */
export function randomizeQuestions<T extends { disabled?: boolean }>(questions: T[], shouldRandomize?: boolean, limit?: number): T[] {
  const qs = [...questions];
  if (qs.length <= 1) return qs;

  const first = qs[0];
  let rest = qs.slice(1).filter(q => !q.disabled);

  if (shouldRandomize) {
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
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
