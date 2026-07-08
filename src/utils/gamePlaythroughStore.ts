/**
 * Session-scoped, in-memory per-game playthrough store, keyed by the game's
 * stable `gameId` (the gameRef, e.g. "georgs-quiz/v1").
 *
 * Its only job today is to keep a randomized game's shuffle **seed** stable for
 * the whole session, so a game re-entered via back-navigation shows the SAME
 * question order it was played in (the deck is not re-shuffled on remount).
 *
 * In-memory only: a full page reload re-initializes the module and clears it,
 * which matches the navigation rule that a reload restarts the show from home
 * (no resume after reload). See specs/game-back-review.md.
 */
const seeds = new Map<string, number>();

/**
 * Returns the stored shuffle seed for `gameId`, generating and storing one via
 * `gen` on first request. Subsequent calls (including after a component remount)
 * return the same seed, so `randomizeQuestions` reproduces the identical order.
 */
export function getStableSeed(gameId: string, gen: () => number): number {
  const existing = seeds.get(gameId);
  if (existing !== undefined) return existing;
  const created = gen();
  seeds.set(gameId, created);
  return created;
}

/** Clears all stored playthrough state. Exposed for tests. */
export function clearPlaythroughStore(): void {
  seeds.clear();
}
