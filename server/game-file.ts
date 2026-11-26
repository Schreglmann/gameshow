/**
 * Pure helpers for game-file structure transforms. Kept separate from the route handler in
 * server/index.ts so the single→multi conversion is unit-testable in isolation.
 */

/** A game-file object as read from disk (loosely typed — we only restructure top-level keys). */
type GameFileObject = Record<string, unknown>;

/**
 * Convert a single-instance game file to multi-instance form: existing content becomes instance
 * `v1`. The multi-instance top-level fields (`type`, `title`, `rules`, `randomizeQuestions`) stay
 * at the base; every OTHER key (questions, quizjagd's easy/medium/hard, …) moves into
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

/**
 * Count questions in a game's `questions` field. Most game types store a flat array; quizjagd
 * stores `{ easy, medium, hard }` arrays. Returns 0 for any other/missing shape.
 */
export function countQuestions(questions: unknown): number {
  if (Array.isArray(questions)) return questions.length;
  if (questions && typeof questions === 'object') {
    return Object.values(questions as Record<string, unknown>).reduce<number>(
      (sum, v) => sum + (Array.isArray(v) ? v.length : 0),
      0,
    );
  }
  return 0;
}

const isArchiveKey = (key: string) => key.toLowerCase() === 'archive';

/**
 * Instance keys a gameshow may reference in `gameOrder`. The archive instance is hidden, except
 * when no other instance has any questions — then it is exposed as the fallback. An empty `v1`
 * (`questions: []`) counts the same as `v1` not existing.
 */
export function selectableInstanceKeys(instances: Record<string, unknown>): string[] {
  const allKeys = Object.keys(instances);
  const archiveKey = allKeys.find(isArchiveKey);
  const nonArchiveKeys = allKeys.filter(k => !isArchiveKey(k));
  const hasNonEmptyNonArchive = nonArchiveKeys.some(k => {
    const inst = instances[k] as { questions?: unknown } | undefined;
    return countQuestions(inst?.questions) > 0;
  });
  return archiveKey && !hasNonEmptyNonArchive ? [...nonArchiveKeys, archiveKey] : nonArchiveKeys;
}

/**
 * The part of a game file that gameshows actually play, given the instance names their `gameOrder`
 * refs point at (`null` for a bare ref like `"trump-oder-hitler"`). A single-instance file is played
 * whole; a multi-instance file keeps its base fields plus only the referenced instances — including
 * `archive` when a gameshow references it. Returns `null` when no ref plays any part of the file.
 * Backs the DAM "In Gameshow" filter.
 */
export function gameshowPlayedContent(
  fileContent: GameFileObject,
  instanceNames: Iterable<string | null>,
): GameFileObject | null {
  const names = new Set(instanceNames);
  const instances = fileContent.instances;
  if (!instances || typeof instances !== 'object') return names.size > 0 ? fileContent : null;
  const record = instances as Record<string, unknown>;
  const played = Object.fromEntries(Object.entries(record).filter(([key]) => names.has(key)));
  if (Object.keys(played).length === 0) return null;
  return { ...fileContent, instances: played };
}
