/**
 * Pure helpers for the Papierkorb (trash view) endpoints. Extracted from
 * server/index.ts so they can be exercised by unit tests without spawning the
 * full server (which starts listening on import).
 *
 * See specs/admin-backend.md → Papierkorb (trash view).
 */

export const TRASH_BATCH_ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

export type TrashMediaType = 'image' | 'audio' | 'video' | 'other';

const TRASH_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp']);
const TRASH_AUDIO_EXTS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac', 'opus']);
const TRASH_VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi']);

/**
 * Reject `..`, NUL bytes, and dot-prefixed path segments. Throws so callers
 * can convert to HTTP 400. Identical rules to the DELETE handler at
 * server/index.ts so on-disk trash can never become a path-traversal vector.
 */
export function assertSafeTrashOriginalPath(p: string): void {
  if (typeof p !== 'string' || p === '') throw new Error('Invalid path');
  if (p.includes('..') || p.includes('\0')) throw new Error('Invalid path');
  if (p.split('/').some(seg => !seg || seg.startsWith('.'))) throw new Error('Invalid path');
}

/** Classify a file by extension for the trash-list response. Folders always return `other`. */
export function mediaTypeFromPath(p: string, isDirectory: boolean): TrashMediaType {
  if (isDirectory) return 'other';
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  if (TRASH_IMAGE_EXTS.has(ext)) return 'image';
  if (TRASH_AUDIO_EXTS.has(ext)) return 'audio';
  if (TRASH_VIDEO_EXTS.has(ext)) return 'video';
  return 'other';
}
