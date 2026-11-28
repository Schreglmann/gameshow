// Normalise a free-form search term into a filename basename in Title Case:
// trim, collapse runs of whitespace, lowercase everything, then uppercase the
// first character of every word. Used by the internet image-search flows to
// name downloads after the search term (e.g. "matthew  mercer" → "Matthew Mercer").
export function toTitleCaseName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!collapsed) return '';
  return collapsed
    .split(' ')
    .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Timestamp part of a pasted image's filename: `2026-11-26T14-03-07`. */
export function pasteTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// Rename a clipboard image to `pasted-<ts>[-<index>].<ext>`. Browsers name every
// pasted image `image.png`, and the upload route does not resolve name
// collisions, so repeated pastes would overwrite each other without this.
export function pastedImageFile(file: File, ts: string, index = 0): File {
  const ext = file.name.includes('.')
    ? file.name.split('.').pop()!.toLowerCase()
    : (file.type.split('/')[1]?.split('+')[0] || 'png');
  const suffix = index > 0 ? `-${index}` : '';
  return new File([file], `pasted-${ts}${suffix}.${ext}`, { type: file.type });
}
