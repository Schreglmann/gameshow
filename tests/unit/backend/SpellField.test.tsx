import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SpellField from '@/components/backend/SpellField';
import { SpellCheckProvider, type SpellCheckCtxValue } from '@/components/backend/SpellCheckContext';
import type { SpellMatch } from '@/services/backendApi';

const match: SpellMatch = {
  message: 'Möglicher Tippfehler', shortMessage: 'Tippfehler', offset: 0, length: 6,
  replacements: ['Paris'], ruleId: 'GERMAN_SPELLER_RULE', issueType: 'misspelling',
  categoryId: 'TYPOS', categoryName: 'Tippfehler', fingerprint: 'GERMAN_SPELLER_RULE::pariss',
};

function ctx(overrides: Partial<SpellCheckCtxValue> = {}): SpellCheckCtxValue {
  return {
    enabled: true,
    getMatches: (k) => (k === 'q0.answer' ? [match] : []),
    apply: () => {},
    allowWord: () => {},
    ignore: () => {},
    ...overrides,
  };
}

describe('SpellField', () => {
  it('renders a bare input (no overlay) when there is no provider', () => {
    const { container } = render(<SpellField segKey="q0.answer" className="be-input" value="Pariss" onChange={() => {}} />);
    expect(container.querySelector('.spellfield-overlay')).toBeNull();
    expect(container.querySelector('input.be-input')).not.toBeNull();
  });

  it('renders a bare input when enabled but the field has no matches', () => {
    const { container } = render(
      <SpellCheckProvider value={ctx()}>
        <SpellField segKey="q9.clean" className="be-input" value="Korrekt" onChange={() => {}} />
      </SpellCheckProvider>
    );
    expect(container.querySelector('.spellfield-overlay')).toBeNull();
  });

  it('renders an overlay with a spelling underline when the field has a match', () => {
    const { container } = render(
      <SpellCheckProvider value={ctx()}>
        <SpellField segKey="q0.answer" className="be-input" value="Pariss" onChange={() => {}} />
      </SpellCheckProvider>
    );
    expect(container.querySelector('.spellfield-overlay')).not.toBeNull();
    const underline = container.querySelector('.spell-underline--spelling');
    expect(underline?.textContent).toBe('Pariss');
  });

  it('opens a popover on click and applies a suggestion', async () => {
    const apply = vi.fn();
    render(
      <SpellCheckProvider value={ctx({ apply })}>
        <SpellField segKey="q0.answer" className="be-input" value="Pariss" onChange={() => {}} />
      </SpellCheckProvider>
    );
    await userEvent.click(screen.getByRole('textbox'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '„Paris“' }));
    // The context's apply receives (segKey, match, replacement).
    expect(apply).toHaveBeenCalledWith('q0.answer', match, 'Paris');
  });
});
