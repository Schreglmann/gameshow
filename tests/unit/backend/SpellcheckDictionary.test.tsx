import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Controllable stub of the spellcheck settings context (the real provider fetches from the API).
const mocks = vi.hoisted(() => ({
  setSkipNames: vi.fn(() => Promise.resolve()),
  allowWord: vi.fn(() => Promise.resolve()),
  removeWord: vi.fn(() => Promise.resolve()),
  ignoreMatch: vi.fn(() => Promise.resolve()),
  unignoreMatch: vi.fn(() => Promise.resolve()),
  state: { skipNames: true, allowedWords: ['Inception'], ignoredMatches: ['RULE_X::voulez vous'] },
}));

vi.mock('@/components/backend/SpellcheckSettingsContext', () => ({
  useSpellcheckSettings: () => ({
    loading: false,
    enabled: true,
    skipNames: mocks.state.skipNames,
    allowedWords: mocks.state.allowedWords,
    ignoredMatches: mocks.state.ignoredMatches,
    refresh: vi.fn(),
    setEnabled: vi.fn(),
    setSkipNames: mocks.setSkipNames,
    allowWord: mocks.allowWord,
    removeWord: mocks.removeWord,
    ignoreMatch: mocks.ignoreMatch,
    unignoreMatch: mocks.unignoreMatch,
  }),
}));

import SpellcheckDictionary from '@/components/backend/SpellcheckDictionary';

describe('SpellcheckDictionary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.skipNames = true;
    mocks.state.allowedWords = ['Inception'];
    mocks.state.ignoredMatches = ['RULE_X::voulez vous'];
  });

  it('lists allowed words and the readable part of ignored fingerprints', () => {
    render(<SpellcheckDictionary onBack={() => {}} />);
    expect(screen.getByText('Inception')).toBeInTheDocument();
    expect(screen.getByText('voulez vous')).toBeInTheDocument(); // word part, not the rule id
    expect(screen.getByText('RULE_X')).toBeInTheDocument();       // rule id shown as a hint
  });

  it('adds a new allowed word (submit via Enter)', async () => {
    render(<SpellcheckDictionary onBack={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText('Wort hinzufügen…'), 'Reykjavík{Enter}');
    expect(mocks.allowWord).toHaveBeenCalledWith('Reykjavík');
  });

  it('adds an ignored fingerprint (submit via Enter)', async () => {
    render(<SpellcheckDictionary onBack={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText('Fingerprint einfügen (regelId::wort)…'), 'RULE_Y::test{Enter}');
    expect(mocks.ignoreMatch).toHaveBeenCalledWith('RULE_Y::test');
  });

  it('removes an allowed word', async () => {
    render(<SpellcheckDictionary onBack={() => {}} />);
    // The allowed-word row's delete button (×).
    const row = screen.getByText('Inception').closest('.spell-dict-row') as HTMLElement;
    await userEvent.click(row.querySelector('.spell-dict-del') as HTMLElement);
    expect(mocks.removeWord).toHaveBeenCalledWith('Inception');
  });

  it('edits (renames) an allowed word via remove + add', async () => {
    render(<SpellcheckDictionary onBack={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const input = screen.getByDisplayValue('Inception');
    await userEvent.clear(input);
    await userEvent.type(input, 'Interstellar');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(mocks.removeWord).toHaveBeenCalledWith('Inception');
    expect(mocks.allowWord).toHaveBeenCalledWith('Interstellar');
  });

  it('un-ignores a match', async () => {
    render(<SpellcheckDictionary onBack={() => {}} />);
    const row = screen.getByText('voulez vous').closest('.spell-dict-row') as HTMLElement;
    await userEvent.click(row.querySelector('.spell-dict-del') as HTMLElement);
    expect(mocks.unignoreMatch).toHaveBeenCalledWith('RULE_X::voulez vous');
  });

  it('toggles "Namen nicht prüfen"', async () => {
    render(<SpellcheckDictionary onBack={() => {}} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(mocks.setSkipNames).toHaveBeenCalledWith(false); // currently on → turning off
  });

  it('calls onBack from the back button', async () => {
    const onBack = vi.fn();
    render(<SpellcheckDictionary onBack={onBack} />);
    await userEvent.click(screen.getByRole('button', { name: '← Zurück' }));
    expect(onBack).toHaveBeenCalled();
  });
});
