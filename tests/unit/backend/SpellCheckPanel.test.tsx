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

  it('summarizes spelling vs grammar counts at the top once a scan has results', () => {
    render(<SpellCheckPanel groups={groups} onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />);
    expect(screen.getByText('1 Rechtschreibung')).toBeInTheDocument();
    expect(screen.getByText('1 Grammatik')).toBeInTheDocument();
  });

  it('filters to only spelling issues when the Rechtschreibung pill is clicked, and back on re-click', async () => {
    const user = userEvent.setup();
    render(<SpellCheckPanel groups={groups} onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />);
    // Both issues visible initially (their context sentences are present).
    expect(screen.getByText(/Hauptstdat/)).toBeInTheDocument();
    expect(screen.getByText(/Buch/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1 Rechtschreibung' }));
    expect(screen.getByText(/Hauptstdat/)).toBeInTheDocument(); // spelling kept
    expect(screen.queryByText(/Buch/)).toBeNull();              // grammar hidden

    await user.click(screen.getByRole('button', { name: '1 Rechtschreibung' })); // toggle off
    expect(screen.getByText(/Buch/)).toBeInTheDocument();       // grammar back
  });

  it('filters to only grammar issues when the Grammatik pill is clicked', async () => {
    const user = userEvent.setup();
    render(<SpellCheckPanel groups={groups} onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />);
    await user.click(screen.getByRole('button', { name: '1 Grammatik' }));
    expect(screen.getByText(/Buch/)).toBeInTheDocument();
    expect(screen.queryByText(/Hauptstdat/)).toBeNull();
  });

  it('disables a pill whose count is 0', () => {
    render(<SpellCheckPanel groups={[{ issues: [spellingIssue] }]} onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />);
    expect(screen.getByRole('button', { name: '0 Grammatik' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '1 Rechtschreibung' })).toBeEnabled();
  });

  it('does not show the count summary while loading or empty', () => {
    // The summary pills carry the count ("1 Rechtschreibung"); the per-issue tag is just
    // "Rechtschreibung", so querying the counted text isolates the summary.
    const { rerender } = render(
      <SpellCheckPanel groups={groups} loading progress={{ phase: 'check', done: 0, total: 5 }} onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />,
    );
    expect(screen.queryByText('1 Rechtschreibung')).toBeNull();
    rerender(<SpellCheckPanel groups={[]} onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />);
    expect(screen.queryByText('0 Grammatik')).toBeNull();
  });

  it('shows the load phase counting games', () => {
    render(<SpellCheckPanel groups={[]} loading progress={{ phase: 'load', done: 2, total: 5 }} onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />);
    expect(screen.getByText(/Lade Spiele · 2 \/ 5/)).toBeInTheDocument();
  });

  it('shows the check phase as scope (text fields) with an indeterminate bar, not a stuck fraction', () => {
    render(<SpellCheckPanel groups={[]} loading progress={{ phase: 'check', done: 0, total: 1600 }} onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />);
    expect(screen.getByText(/Prüfe Rechtschreibung · 1600 Textfelder/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Prüfung läuft' })).toBeInTheDocument();
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
