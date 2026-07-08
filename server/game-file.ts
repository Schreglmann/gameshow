/**
 * Pure helpers for game-file structure transforms. Kept separate from the route handler in
 * server/index.ts so the single→multi conversion is unit-testable in isolation.
 */

/** A game-file object as read from disk (loosely typed — we only restructure top-level keys). */
type GameFileObject = Record<string, unknown>;

/**
 * Convert a single-instance game file to multi-instance form: existing content becomes instance
 * `v1`. The multi-instance top-level fields (`type`, `title`, `rules`, `randomizeQuestions`) stay
 * at the base; every OTHER key (questions, quizjagd's easy/medium/hard, `_players`, …) moves into
 * the `v1` instance. This is the exact inverse of the server's `{ ...base, ...instance }` merge,
 * so loading `<file>/v1` reconstructs the original config byte-for-byte.
 *
 * Idempotent: a file that already has `instances` is returned unchanged.
 */
export function convertToMultiInstance(fileContent: GameFileObject): GameFileObject {
  if ('instances' in fileContent && fileContent.instances) return fileContent;
  const { type, title, rules, randomizeQuestions, ...content } = fileContent;
  return {
    type,
    title,
    ...(rules !== undefined && { rules }),
    ...(randomizeQuestions !== undefined && { randomizeQuestions }),
    instances: { v1: content },
  };
}
