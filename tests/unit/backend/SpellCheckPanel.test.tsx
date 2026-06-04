import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SpellCheckPanel, { type SpellGroup, type SpellIssue } from '@/components/backend/SpellCheckPanel';
import type { SpellMatch } from '@/services/backendApi';

function mkMatch(overrides: Partial<SpellMatch> = {}): SpellMatch {
  return {
    message: 'Möglicher Rechtschreibfehler',
    shortMessage: 'Tippfehler',
    offset: 4,
    length: 10,
    replacements: ['Hauptstadt'],
    ruleId: 'GERMAN_SPELLER_RULE',
    issueType: 'misspelling',
    categoryId: 'TYPOS',
    categoryName: 'Mögliche Tippfehler',
    fingerprint: 'GERMAN_SPELLER_RULE::hauptstdat',
    ...overrides,
  };
}

const spellingIssue: SpellIssue = { id: 's1', label: 'Frage 3 · Antwort', text: 'Die Hauptstdat ...', match: mkMatch() };
const grammarIssue: SpellIssue = {
  id: 'g1',
  label: 'Frage 5 · Fragetext',
  text: 'Wem gab er dem Buch?',
  match: mkMatch({ offset: 11, length: 3, replacements: ['das'], ruleId: 'DE_AGREEMENT', issueType: 'grammar', categoryId: 'GRAMMAR', fingerprint: 'DE_AGREEMENT::dem' }),
};

const groups: SpellGroup[] = [{ issues: [spellingIssue, grammarIssue] }];

describe('SpellCheckPanel', () => {
  it('shows an always-German explanation (not LanguageTool’s raw message)', () => {
    // A match whose LanguageTool message is foreign (Breton) must still render German.
    const foreign: SpellIssue = { id: 'f1', label: 'Frage 1', text: 'Goisern', match: mkMatch({ message: 'Fazi reizhskrivañ posupl kavet.', offset: 0, length: 7 }) };
    render(<SpellCheckPanel groups={[{ issues: [foreign] }]} onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />);
    expect(screen.queryByText('Fazi reizhskrivañ posupl kavet.')).toBeNull();
    expect(screen.getByText('Unbekanntes oder möglicherweise falsch geschriebenes Wort.')).toBeInTheDocument();
  });

  it('renders the empty state when there are no issues and not loading', () => {
    render(<SpellCheckPanel groups={[]} onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />);
    expect(screen.getByText('Keine Auffälligkeiten gefunden.')).toBeInTheDocument();
  });

  it('shows a loading status with progress', () => {
    render(<SpellCheckPanel groups={[]} loading progress={{ done: 2, total: 5 }} onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />);
    expect(screen.getByText(/2 \/ 5 Spiele/)).toBeInTheDocument();
  });

  it('renders an error banner', () => {
    render(<SpellCheckPanel groups={[]} error="LanguageTool nicht erreichbar." onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />);
    expect(screen.getByText('LanguageTool nicht erreichbar.')).toBeInTheDocument();
  });

  it('calls onApply with the chosen replacement', async () => {
    const onApply = vi.fn();
    render(<SpellCheckPanel groups={groups} onApply={onApply} onAllowWord={() => {}} onIgnore={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '„Hauptstadt“' }));
    expect(onApply).toHaveBeenCalledWith(spellingIssue, 'Hauptstadt');
  });

  it('shows "Wort erlauben" only for spelling issues and wires it', async () => {
    const onAllowWord = vi.fn();
    render(<SpellCheckPanel groups={groups} onApply={() => {}} onAllowWord={onAllowWord} onIgnore={() => {}} />);
    // Exactly one "Wort erlauben" (the spelling issue, not the grammar issue).
    const allowButtons = screen.getAllByRole('button', { name: 'Wort erlauben' });
    expect(allowButtons).toHaveLength(1);
    await userEvent.click(allowButtons[0]);
    expect(onAllowWord).toHaveBeenCalledWith(spellingIssue);
  });

  it('calls onIgnore for any issue', async () => {
    const onIgnore = vi.fn();
    render(<SpellCheckPanel groups={groups} onApply={() => {}} onAllowWord={() => {}} onIgnore={onIgnore} />);
    const ignoreButtons = screen.getAllByRole('button', { name: 'Ignorieren' });
    expect(ignoreButtons).toHaveLength(2);
    await userEvent.click(ignoreButtons[1]);
    expect(onIgnore).toHaveBeenCalledWith(grammarIssue);
  });

  it('applies a free-text correction the user types ("eigene Korrektur")', async () => {
    const onApply = vi.fn();
    render(<SpellCheckPanel groups={[{ issues: [spellingIssue] }]} onApply={onApply} onAllowWord={() => {}} onIgnore={() => {}} />);
    const input = screen.getByLabelText('Eigene Korrektur');
    expect(input).toHaveValue('Hauptstdat'); // pre-filled with the flagged word
    const submit = screen.getByRole('button', { name: 'Übernehmen' });
    expect(submit).toBeDisabled(); // unchanged → nothing to apply
    await userEvent.clear(input);
    await userEvent.type(input, 'Hauptstädtchen');
    await userEvent.click(submit);
    expect(onApply).toHaveBeenCalledWith(spellingIssue, 'Hauptstädtchen');
  });
});
