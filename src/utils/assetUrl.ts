/**
 * Build a browser-safe URL path for a local asset, encoding each path segment.
 *
 * Asset filenames can legitimately contain characters that are special in a URL —
 * most dangerously `#` (fragment) and `?` (query), but also `&`, `[`, `]`, `+`,
 * spaces, etc. A YouTube download like
 *   `Armin van Buuren - … [Live at Unfiltered #3].mp4`
 * dropped into a `<video src>` raw makes the browser request only
 *   `/videos/Armin van Buuren - … [Live at Unfiltered ` (truncated at `#`),
 * which 404s/redirects → the element gets a non-video response and reports
 * `MEDIA_ERR_SRC_NOT_SUPPORTED` ("Format nicht browserkompatibel") — i.e. a
 * codec-looking error that is really a broken URL.
 *
 * We encode per segment (not the whole string) so `/` separators survive while
 * everything else is percent-encoded. The server decodes `req.path` automatically,
 * so `%23` → `#` round-trips back to the real filename.
 */
export function encodeAssetPath(relPath: string): string {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

/** Convenience: a full `/<category>/<encoded-path>` URL for a DAM asset. */
export function assetUrl(category: string, relPath: string): string {
  return `/${category}/${encodeAssetPath(relPath)}`;
}

/**
 * Encode a stored media path for use as a DOM `src` (`<img>`, `<audio>`, `<video>`,
 * `new Audio()`, prefetch). Game config stores local paths like `/images/foo #3.jpg`;
 * those must be percent-encoded so `#`/`?`/`&` don't break the URL. Absolute URLs
 * (`http(s):`, `data:`, `blob:`) are passed through untouched — encoding them would
 * corrupt the scheme (`https:` → `https%3A`).
 */
export function toMediaSrc(path: string | undefined): string | undefined {
  if (!path) return path;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return encodeAssetPath(path);
}
