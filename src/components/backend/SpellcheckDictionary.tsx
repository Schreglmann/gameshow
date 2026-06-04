/**
 * Wörterbuch — the spellcheck dictionary subpage. Manages the two kinds of permanent
 * false-positive overrides (allowed words + ignored matches) plus the "skip names" toggle.
 * Reached from the Korrektur tab via "Wörterbuch verwalten" so the main scan page stays clean.
 * See specs/spellcheck.md.
 */

import { useState, type FormEvent } from 'react';
import { useSpellcheckSettings } from './SpellcheckSettingsContext';
import { ruleExplanationDe } from '@/utils/spellcheckExplain';

interface Props {
  onBack: () => void;
}

/** A fingerprint is `<ruleId>::<matched word>`; show the word prominently, the rule as a hint. */
function splitFingerprint(fp: string): { word: string; rule: string } {
  const idx = fp.indexOf('::');
  if (idx === -1) return { word: fp, rule: '' };
  return { rule: fp.slice(0, idx), word: fp.slice(idx + 2) };
}

export default function SpellcheckDictionary({ onBack }: Props) {
  const settings = useSpellcheckSettings();
  const [newWord, setNewWord] = useState('');
  const [newFingerprint, setNewFingerprint] = useState('');
  const [editing, setEditing] = useState<{ original: string; value: string } | null>(null);

  const addWord = (e: FormEvent) => {
    e.preventDefault();
    const w = newWord.trim();
    if (!w) return;
    void settings.allowWord(w);
    setNewWord('');
  };

  const saveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const next = editing.value.trim();
    const original = editing.original;
    setEditing(null);
    if (!next || next === original) return;
    void (async () => {
      await settings.removeWord(original);
      await settings.allowWord(next);
    })();
  };

  const addFingerprint = (e: FormEvent) => {
    e.preventDefault();
    const fp = newFingerprint.trim();
    if (!fp) return;
    void settings.ignoreMatch(fp);
    setNewFingerprint('');
  };

  return (
    <div className="spell-dict">
      <div className="spell-dict-head">
        <button type="button" className="be-icon-btn spell-dict-back" onClick={onBack}>← Zurück</button>
        <h2 className="spell-dict-title">Wörterbuch</h2>
      </div>

      <div className="spell-dict-option">
        <div className="spell-dict-option-text">
          <span className="spell-dict-option-title">Namen nicht prüfen</span>
          <span className="spell-dict-option-sub">
            Großgeschriebene Wörter ohne nahe Korrektur (Namen, Bands, Orte, Titel) werden nicht
            als Fehler markiert. Echte Tippfehler bleiben markiert.
          </span>
        </div>
        <label className="be-toggle">
          <input
            type="checkbox"
            checked={settings.skipNames}
            disabled={settings.loading}
            onChange={e => { void settings.setSkipNames(e.target.checked); }}
          />
          <span className="be-toggle-track" />
          <span className="be-toggle-label">{settings.skipNames ? 'Aktiv' : 'Aus'}</span>
        </label>
      </div>

      <section className="spell-dict-section">
        <h3 className="spell-dict-section-title">Erlaubte Wörter</h3>
        <p className="spell-dict-section-hint">Wörter, die nie als Rechtschreibfehler markiert werden.</p>
        <form className="spell-dict-add" onSubmit={addWord}>
          <input
            className="be-input"
            placeholder="Wort hinzufügen…"
            value={newWord}
            onChange={e => setNewWord(e.target.value)}
          />
          <button type="submit" className="be-btn-primary" disabled={!newWord.trim()}>Hinzufügen</button>
        </form>
        {settings.allowedWords.length === 0 ? (
          <div className="spell-dict-empty">Noch keine erlaubten Wörter.</div>
        ) : (
          <ul className="spell-dict-list">
            {settings.allowedWords.map(w => (
              <li className="spell-dict-row" key={w}>
                {editing?.original === w ? (
                  <form className="spell-dict-edit" onSubmit={saveEdit}>
                    <input
                      className="be-input"
                      value={editing.value}
                      autoFocus
                      onChange={e => setEditing({ original: w, value: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Escape') setEditing(null); }}
                    />
                    <button type="submit" className="be-btn-primary">Speichern</button>
                    <button type="button" className="be-icon-btn" onClick={() => setEditing(null)}>Abbrechen</button>
                  </form>
                ) : (
                  <>
                    <span className="spell-dict-word">{w}</span>
                    <span className="spell-dict-row-actions">
                      <button type="button" className="be-icon-btn" onClick={() => setEditing({ original: w, value: w })}>Bearbeiten</button>
                      <button type="button" className="be-icon-btn spell-dict-del" title="Entfernen" onClick={() => void settings.removeWord(w)}>×</button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="spell-dict-section">
        <h3 className="spell-dict-section-title">Ignorierte Hinweise</h3>
        <p className="spell-dict-section-hint">Einzelne Grammatik-/Stilhinweise, die unterdrückt werden (per Fingerprint).</p>
        <form className="spell-dict-add" onSubmit={addFingerprint}>
          <input
            className="be-input"
            placeholder="Fingerprint einfügen (regelId::wort)…"
            value={newFingerprint}
            onChange={e => setNewFingerprint(e.target.value)}
          />
          <button type="submit" className="be-btn-primary" disabled={!newFingerprint.trim()}>Hinzufügen</button>
        </form>
        {settings.ignoredMatches.length === 0 ? (
          <div className="spell-dict-empty">Noch keine ignorierten Hinweise.</div>
        ) : (
          <ul className="spell-dict-list">
            {settings.ignoredMatches.map(fp => {
              const { word, rule } = splitFingerprint(fp);
              return (
                <li className="spell-dict-row" key={fp}>
                  <span className="spell-dict-fp">
                    <span className="spell-dict-word">{word}</span>
                    {rule && <code className="spell-dict-rule" title={ruleExplanationDe(rule)}>{rule}</code>}
                  </span>
                  <span className="spell-dict-row-actions">
                    <button type="button" className="be-icon-btn spell-dict-del" title="Entfernen" onClick={() => void settings.unignoreMatch(fp)}>×</button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
