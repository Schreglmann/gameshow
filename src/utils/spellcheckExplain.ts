/**
 * Always-German explanations for spellcheck matches.
 *
 * LanguageTool localizes its `message` to the *detected* language of the field — so a short
 * answer misdetected as French/Breton/Italian comes back with a foreign message (e.g.
 * "Fazi reizhskrivañ posupl kavet."). For a German-facing admin we never show that raw message;
 * instead we derive a German explanation from the language-INDEPENDENT tokens every match carries
 * (`issueType`, `categoryId`, `ruleId`). `ruleExplanationDe` additionally decodes the rule id —
 * including the language of `MORFOLOGIK_RULE_<LL>_<CC>` — for hover tooltips.
 *
 * See specs/spellcheck.md.
 */

/** The fields of a match this module reads — a structural subset of SpellMatch / LocalMatch. */
export interface ExplainableMatch {
  issueType: string;
  categoryId: string;
  ruleId: string;
}

// German names for the locale codes that appear in MORFOLOGIK_RULE_<LL>(_<CC>) rule ids.
const LANGUAGE_NAMES_DE: Record<string, string> = {
  DE: 'Deutsch', EN: 'Englisch', FR: 'Französisch', IT: 'Italienisch', ES: 'Spanisch',
  PT: 'Portugiesisch', NL: 'Niederländisch', PL: 'Polnisch', RU: 'Russisch', BR: 'Bretonisch',
  CA: 'Katalanisch', GL: 'Galicisch', RO: 'Rumänisch', SV: 'Schwedisch', DA: 'Dänisch',
  SK: 'Slowakisch', SL: 'Slowenisch', UK: 'Ukrainisch', EL: 'Griechisch', FA: 'Persisch',
  JA: 'Japanisch', ZH: 'Chinesisch', AR: 'Arabisch', TA: 'Tamilisch', GA: 'Irisch',
  AST: 'Asturisch', BE: 'Belarussisch', EO: 'Esperanto', CS: 'Tschechisch', TL: 'Tagalog',
  NB: 'Norwegisch', NN: 'Norwegisch (Nynorsk)', KM: 'Khmer', CRH: 'Krimtatarisch',
};

function languageNameDe(code: string): string {
  return LANGUAGE_NAMES_DE[code.toUpperCase()] ?? code.toUpperCase();
}

function isSpellingMatch(m: ExplainableMatch): boolean {
  return m.issueType === 'misspelling'
    || m.categoryId.toUpperCase() === 'TYPOS'
    || /MORFOLOGIK|SPELLER|HUNSPELL/i.test(m.ruleId);
}

/**
 * A short, ALWAYS-German explanation of what kind of issue this is — shown as the issue's
 * message in the report panel and the inline popover. Independent of LanguageTool's own
 * (possibly foreign-language) message.
 */
export function issueExplanationDe(match: ExplainableMatch): string {
  const cat = match.categoryId.toUpperCase();
  const type = match.issueType.toLowerCase();
  if (isSpellingMatch(match)) return 'Unbekanntes oder möglicherweise falsch geschriebenes Wort.';
  if (cat === 'CASING') return 'Groß-/Kleinschreibung prüfen.';
  if (cat === 'PUNCTUATION' || cat === 'TYPOGRAPHY' || type === 'typographical' || type === 'whitespace') {
    return 'Zeichensetzung oder Typografie prüfen.';
  }
  if (cat === 'CONFUSED_WORDS') return 'Möglicherweise verwechselte Wörter.';
  if (cat === 'REDUNDANCY' || cat === 'STYLE' || type === 'style') return 'Stilistischer Hinweis.';
  if (cat === 'COLLOQUIALISMS') return 'Umgangssprachlicher Ausdruck.';
  if (type === 'grammar' || cat === 'GRAMMAR') return 'Möglicher Grammatikfehler.';
  return 'Möglicher sprachlicher Fehler.';
}

/**
 * A German explanation of a LanguageTool RULE ID, for hover tooltips. Decodes the spell-checker
 * families (including the language of `MORFOLOGIK_RULE_*`) precisely; for grammar/style rules it
 * gives a generic note plus the raw id (which often encodes the language/topic itself).
 */
export function ruleExplanationDe(ruleId: string): string {
  if (!ruleId) return 'LanguageTool-Regel.';
  const morf = /^MORFOLOGIK_RULE_([A-Z]{2,3})(?:_[A-Z]{2,3})?$/i.exec(ruleId);
  if (morf) {
    return `Rechtschreibprüfung (${languageNameDe(morf[1])}): Das Wort steht nicht im Wörterbuch – meist ein Eigenname.`;
  }
  if (ruleId === 'GERMAN_SPELLER_RULE') {
    return 'Deutsche Rechtschreibprüfung: unbekanntes Wort – meist ein Eigenname.';
  }
  if (ruleId === 'HUNSPELL_RULE') {
    return 'Rechtschreibprüfung (Hunspell-Wörterbuch): unbekanntes Wort – meist ein Eigenname.';
  }
  if (/SPELLER_RULE$|HUNSPELL|MORFOLOGIK|SPELL/i.test(ruleId)) {
    return 'Rechtschreibprüfung: unbekanntes Wort – meist ein Eigenname.';
  }
  return `Grammatik-/Stilregel von LanguageTool (${ruleId}): wird ausgelöst, wenn ein bestimmtes sprachliches Muster erkannt wird.`;
}
