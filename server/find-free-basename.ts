import path from 'path';
import { existsSync } from 'fs';

// Probe `<base><ext>`, `<base> 2<ext>`, `<base> 3<ext>`, … until a free name is
// found in `dir`. Used by the download-url endpoint when a client supplies a
// `desiredName` (internet image-search flows) so multiple downloads with the
// same search term don't overwrite each other. The caller is responsible for
// creating `dir` ahead of time.
export function findFreeBasename(dir: string, base: string, ext: string): string {
  const first = `${base}${ext}`;
  if (!existsSync(path.join(dir, first))) return first;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}${ext}`;
    if (!existsSync(path.join(dir, candidate))) return candidate;
  }
  throw new Error('Cannot find a free filename');
}
