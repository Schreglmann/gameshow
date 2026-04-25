/** Shared helper for the "ghost row" UX in admin question editors:
 *  always render one empty question below the last real one — when the user
 *  types into it, it becomes a real question. The persisted JSON never carries
 *  the editor-only trailing empty slot. */
export function stripTrailingEmpty<T>(items: T[], isEmpty: (item: T) => boolean): T[] {
  const next = [...items];
  while (next.length > 0 && isEmpty(next[next.length - 1])) next.pop();
  return next;
}
