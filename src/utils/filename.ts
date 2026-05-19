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
