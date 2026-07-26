import type { PlayOrder } from '@/utils/questionOrder';

/**
 * Session-scoped, in-memory per-game playthrough store, keyed by the game's
 * stable `gameId` (the gameRef, e.g. "georgs-quiz/v1").
 *
 * It keeps two things alive for the whole session:
 *
 *  - the shuffle **seed**, so a game re-entered via back-navigation shows the
 *    same question order it was played in (see specs/game-back-review.md), and
 *  - the reconciled **play order** ([PlayOrder](./questionOrder.ts)), so editing
 *    the running game's questions in the admin adds/removes questions without
 *    re-dealing the deck (see specs/live-question-order.md).
 *
 * Storing the order — not just the seed — is what makes the guarantee survive a
 * *length* change: the seeded permutation alone depends on the list length, so
 * adding or removing a question used to re-shuffle everything.
 *
 * In-memory only: a full page reload re-initializes the module and clears it,
 * which matches the navigation rule that a reload restarts the show from home
 * (no resume after reload).
 */
interface PlaythroughEntry {
  seed: number;
  order: PlayOrder | null;
  /** Furthest play index reached this playthrough. Back-review resumes here so
   *  it never opens on a question that was appended after the game was played. */
  highWater: number;
}

const entries = new Map<string, PlaythroughEntry>();

function entryFor(gameId: string, gen: () => number): PlaythroughEntry {
  let entry = entries.get(gameId);
  if (!entry) {
    entry = { seed: gen(), order: null, highWater: 0 };
    entries.set(gameId, entry);
  }
  return entry;
}

/**
 * Returns the stored shuffle seed for `gameId`, generating and storing one via
 * `gen` on first request. Subsequent calls (including after a component remount)
 * return the same seed, so the first deal reproduces the identical order.
 */
export function getStableSeed(gameId: string, gen: () => number): number {
  return entryFor(gameId, gen).seed;
}

/** The play order stored for `gameId`, or `null` before the first deal. */
export function getPlayOrder(gameId: string, gen: () => number): PlayOrder | null {
  return entryFor(gameId, gen).order;
}

/** Stores the reconciled play order for `gameId`. */
export function setPlayOrder(gameId: string, order: PlayOrder): void {
  const entry = entries.get(gameId);
  if (entry) entry.order = order;
}

/** The furthest play index reached for `gameId` this session. */
export function getHighWater(gameId: string): number {
  return entries.get(gameId)?.highWater ?? 0;
}

/** Raises the high-water mark for `gameId`; never lowers it. */
export function noteHighWater(gameId: string, playIdx: number): void {
  const entry = entries.get(gameId);
  if (entry && playIdx > entry.highWater) entry.highWater = playIdx;
}

/** Clears all stored playthrough state. Exposed for tests. */
export function clearPlaythroughStore(): void {
  entries.clear();
}
