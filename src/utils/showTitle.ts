/**
 * The title the show calls itself — the landing-page heading, the gamemaster's
 * screen label on the start/summary screens, and the browser tab title.
 *
 * Operator-configurable on two levels (see specs/show-title.md): a global
 * default in `AppConfig.showTitle` (admin Konfiguration tab) and a per-gameshow
 * override in `GameshowConfig.showTitle` (admin Gameshows tab). Resolved in
 * exactly ONE place — `resolveShowTitle()`, called by `GET /api/settings` — so
 * no client re-derives the precedence.
 */

/** What the show is called when neither level configures a title. */
export const DEFAULT_SHOW_TITLE = 'Game Show';

/**
 * Resolve the title of the running show: the active gameshow's override wins,
 * then the global default, then `DEFAULT_SHOW_TITLE`.
 *
 * A blank (or whitespace-only) value counts as unset at BOTH levels, so clearing
 * a field falls through to the next one instead of rendering an empty heading.
 */
export function resolveShowTitle(globalTitle?: string, gameshowTitle?: string): string {
  return gameshowTitle?.trim() || globalTitle?.trim() || DEFAULT_SHOW_TITLE;
}

/**
 * Tolerant read of the wire value (`SettingsResponse.showTitle`): anything
 * missing, non-string, or blank becomes `DEFAULT_SHOW_TITLE`, so
 * `GlobalSettings.showTitle` is always a non-empty string a component can render
 * directly.
 */
export function normalizeShowTitle(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_SHOW_TITLE;
}

/** localStorage key caching the last resolved title — see `readCachedShowTitle`. */
const SHOW_TITLE_CACHE_KEY = 'show:title';

/**
 * Remember the resolved title for the pre-mount gamemaster emit. Purely derived,
 * device-local cache: `emitCachedGamemasterState()` runs before React mounts and
 * before `/api/settings` has answered, so without this a reloading show would
 * flash "Game Show" onto the gamemaster card. Never read as show state.
 */
export function cacheShowTitle(title: string): void {
  try {
    localStorage.setItem(SHOW_TITLE_CACHE_KEY, title);
  } catch { /* quota / disabled storage — the default title is a fine fallback */ }
}

/** The cached title, or `DEFAULT_SHOW_TITLE` when nothing has been cached yet. */
export function readCachedShowTitle(): string {
  try {
    return normalizeShowTitle(localStorage.getItem(SHOW_TITLE_CACHE_KEY));
  } catch {
    return DEFAULT_SHOW_TITLE;
  }
}
