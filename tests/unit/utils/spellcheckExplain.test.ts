import { describe, it, expect } from 'vitest';
import { issueExplanationDe, ruleExplanationDe } from '../../../src/utils/spellcheckExplain.js';

const m = (over: Partial<{ issueType: string; categoryId: string; ruleId: string }> = {}) =>
  ({ issueType: '', categoryId: '', ruleId: '', ...over });

describe('issueExplanationDe', () => {
  it('labels spelling matches (misspelling / TYPOS / speller rules) in German', () => {
    expect(issueExplanationDe(m({ issueType: 'misspelling' }))).toMatch(/falsch geschriebenes Wort/);
    expect(issueExplanationDe(m({ categoryId: 'TYPOS' }))).toMatch(/falsch geschriebenes Wort/);
    expect(issueExplanationDe(m({ ruleId: 'MORFOLOGIK_RULE_IT_IT' }))).toMatch(/falsch geschriebenes Wort/);
  });

  it('labels grammar / casing / punctuation / style in German', () => {
    expect(issueExplanationDe(m({ issueType: 'grammar', categoryId: 'GRAMMAR' }))).toMatch(/Grammatikfehler/);
    expect(issueExplanationDe(m({ categoryId: 'CASING' }))).toMatch(/Groß-\/Kleinschreibung/);
    expect(issueExplanationDe(m({ categoryId: 'PUNCTUATION' }))).toMatch(/Zeichensetzung/);
    expect(issueExplanationDe(m({ categoryId: 'REDUNDANCY' }))).toMatch(/Stilistischer Hinweis/);
  });

  it('falls back to a generic German label for unknown kinds', () => {
    expect(issueExplanationDe(m({ issueType: 'uncategorized', categoryId: 'MISC' }))).toMatch(/sprachlicher Fehler/);
  });
});

describe('ruleExplanationDe', () => {
  it('decodes the language of a MORFOLOGIK_RULE_*', () => {
    expect(ruleExplanationDe('MORFOLOGIK_RULE_IT_IT')).toMatch(/Italienisch/);
    expect(ruleExplanationDe('MORFOLOGIK_RULE_DE_DE')).toMatch(/Deutsch/);
    expect(ruleExplanationDe('MORFOLOGIK_RULE_BR_FR')).toMatch(/Bretonisch/);
  });

  it('describes the named German/Hunspell spell rules', () => {
    expect(ruleExplanationDe('GERMAN_SPELLER_RULE')).toMatch(/Deutsche Rechtschreibprüfung/);
    expect(ruleExplanationDe('HUNSPELL_RULE')).toMatch(/Hunspell/);
  });

  it('gives a German fallback (with the raw id) for grammar/style rules', () => {
    const out = ruleExplanationDe('PRONOMS_PERSONNELS_MINUSCULE');
    expect(out).toMatch(/Grammatik-\/Stilregel/);
    expect(out).toContain('PRONOMS_PERSONNELS_MINUSCULE');
  });

  it('is always German regardless of the rule', () => {
    // No foreign LanguageTool message ever leaks through this function.
    expect(ruleExplanationDe('SOME_UNKNOWN_RULE')).toMatch(/LanguageTool/);
  });
});
