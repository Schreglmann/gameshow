import { useSyncExternalStore } from 'react';
import { useCoverUrl } from '@/context/AudioCoverMetaContext';

// Images replaced or renamed from a game-editor lightbox during this admin session.
// Replacing keeps the path (or only changes its extension), so thumbnails need
// a cache-busting version, and after an extension change the old path must
// show the new file until the editor reloads the rewritten game file.
// Admin UI cache only — not app state. See specs/dam-image-replace.md.

interface Entry { path: string; version: number | null }

// Keyed by the path without a leading slash: `images/Logos/foo.png`.
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let revision = 0;

const normalize = (p: string) => p.replace(/^\/+/, '');

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function record(target: string, newFilename: string, version: number | null): void {
  const from = `images/${target}`;
  const to = `images/${newFilename}`;
  // Earlier replaces that led to `from` now lead on to `to`.
  for (const [key, e] of entries) {
    if (e.path === from) entries.set(key, { path: to, version });
  }
  entries.set(from, { path: to, version });
  entries.set(to, { path: to, version });
  revision++;
  listeners.forEach(l => l());
}

/** Records a replace. `target` and `newFilename` are relative to `images/`. */
export function recordImageReplace(target: string, newFilename: string, version: number): void {
  record(target, newFilename, version);
}

/**
 * Records a rename (`from` → `to`, both relative to `images/`). The bytes did
 * not change and the new path has never been fetched, so no cache-busting
 * version is needed.
 */
export function recordImageRename(from: string, to: string): void {
  if (from === to) return;
  record(from, to, null);
}

/** The path to show for `rawPath` (with a leading slash) and its version, if replaced. */
export function resolveReplacedImage(rawPath: string): { path: string; version: number | null } {
  const e = entries.get(normalize(rawPath));
  return e ? { path: `/${e.path}`, version: e.version } : { path: rawPath, version: null };
}

/**
 * Returns `(rawPath) => DOM src` that follows replaces: it encodes the path
 * (via `useCoverUrl`) and appends `?v=<version>` for a replaced image. The
 * component re-renders whenever a replace is recorded.
 */
export function useImageSrc(): (rawPath: string | undefined) => string | undefined {
  const coverUrl = useCoverUrl();
  useSyncExternalStore(subscribe, () => revision);
  return rawPath => {
    if (!rawPath) return undefined;
    const { path, version } = resolveReplacedImage(rawPath);
    const src = coverUrl(path);
    if (!src || version === null) return src;
    return `${src}${src.includes('?') ? '&' : '?'}v=${version}`;
  };
}

/** Test helper: forget all recorded replaces. */
export function resetReplacedImages(): void {
  entries.clear();
  revision++;
  listeners.forEach(l => l());
}
