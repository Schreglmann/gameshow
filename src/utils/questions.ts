/**
 * Randomizes questions while preserving the first element (example question).
 * If shouldRandomize is false or questions have ≤1 items, returns a copy unchanged.
 */
export function randomizeQuestions<T>(questions: T[], shouldRandomize?: boolean): T[] {
  const qs = [...questions];
  if (!shouldRandomize || qs.length <= 1) return qs;

  const first = qs[0];
  const rest = qs.slice(1).sort(() => Math.random() - 0.5);
  return [first, ...rest];
}

/**
 * Formats a number with dot-separated thousands (German locale).
 * e.g. 1234567 → "1.234.567"
 */
export function formatNumber(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
