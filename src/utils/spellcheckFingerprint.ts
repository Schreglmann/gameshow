/**
 * Stable fingerprint for a LanguageTool match, shared by the server (to filter
 * allowlisted matches) and the admin client (to know whether a match is already
 * ignored). MUST stay identical on both sides — a drift would make "Ignorieren"
 * silently stop working.
 *
 * Formula: `<ruleId>::<matched substring, NFC-normalized, lowercased, trimmed>`.
 *
 * The rule id is stable across LanguageTool versions for a given rule; the
 * normalized matched substring disambiguates which phrase the user chose to
 * ignore without depending on volatile fields (message text, offset).
 */
export function spellMatchFingerprint(ruleId: string, matchedSubstring: string): string {
  const normalized = matchedSubstring.normalize('NFC').toLowerCase().trim();
  return `${ruleId}::${normalized}`;
}

/** Normalize a word for case-insensitive allowlist comparison (matches the fingerprint's word part). */
export function normalizeAllowedWord(word: string): string {
  return word.normalize('NFC').toLowerCase().trim();
}
