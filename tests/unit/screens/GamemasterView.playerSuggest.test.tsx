// The GM "Spieler hinzufügen" fields suggest registry players; a pick fills
// the name in, submitting sends it. See specs/players.md ("Autocomplete").
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterView from '@/components/common/GamemasterView';
import type { GamemasterControl, GamemasterControlsData } from '@/types/game';

const mockControls: { current: GamemasterControlsData | null } = { current: null };
const mockSend = vi.fn();

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => ({ gameTitle: 'T', answer: '', questionNumber: 0, totalQuestions: 0 }),
  useGamemasterControls: () => mockControls.current,
  useSendGamemasterCommand: () => mockSend,
}));

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({ pointSystemEnabled: true, teamRandomizationEnabled: true, globalRules: [] }),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));

const addPlayer: GamemasterControl = {
  type: 'input-group',
  id: 'add-player',
  inputs: [{
    id: 'name',
    label: 'Spieler hinzufügen',
    inputType: 'text',
    suggestions: [
      { id: 'mh', label: 'Michael „Michi“ Huber' },
      { id: 'mp', label: 'Michaela „Michi“ Pichler' },
      { id: 'jb', label: 'Johanna Berger' },
    ],
  }],
  submitLabel: 'Hinzufügen',
  clearOnSubmit: true,
};

function renderView(controls: GamemasterControl[] = [addPlayer]) {
  mockControls.current = { controls };
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterView />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('GamemasterView — player autocomplete', () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  it('lists matching players while typing, with full name and nickname', async () => {
    const user = userEvent.setup();
    renderView();
    const field = screen.getByLabelText('Spieler hinzufügen');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    await user.type(field, 'michi');
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Michael „Michi“ Huber', 'Michaela „Michi“ Pichler']);
  });

  it('a tap fills the name in after the names typed before it; only submitting sends it', async () => {
    const user = userEvent.setup();
    renderView();
    const field = screen.getByLabelText('Spieler hinzufügen');
    await user.type(field, 'Zoe, pich');
    await user.click(screen.getByRole('option', { name: 'Michaela „Michi“ Pichler' }));
    expect(field).toHaveValue('Zoe, Michaela „Michi“ Pichler');
    expect(field).toHaveFocus();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(mockSend).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(mockSend).toHaveBeenCalledWith('add-player', { name: 'Zoe, Michaela „Michi“ Pichler' });
  });

  it('the first Enter on a highlighted entry fills it in, the second submits', async () => {
    const user = userEvent.setup();
    renderView();
    const field = screen.getByLabelText('Spieler hinzufügen');
    await user.type(field, 'jo{ArrowDown}{Enter}');
    expect(field).toHaveValue('Johanna Berger');
    expect(mockSend).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(mockSend).toHaveBeenCalledWith('add-player', { name: 'Johanna Berger' });
  });

  it('Enter without a highlighted entry submits the typed text', async () => {
    const user = userEvent.setup();
    renderView();
    const field = screen.getByLabelText('Spieler hinzufügen');
    await user.type(field, 'Jojo{Enter}');
    expect(mockSend).toHaveBeenCalledWith('add-player', { name: 'Jojo' });
  });

  it('empties the add field after a submit, so the next name starts fresh', async () => {
    const user = userEvent.setup();
    renderView();
    const field = screen.getByLabelText('Spieler hinzufügen');
    await user.type(field, 'Jojo{Enter}');
    expect(mockSend).toHaveBeenCalledWith('add-player', { name: 'Jojo' });
    expect(field).toHaveValue('');
    await user.type(field, 'jo{ArrowDown}{Enter}');
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(mockSend).toHaveBeenLastCalledWith('add-player', { name: 'Johanna Berger' });
    expect(field).toHaveValue('');
  });

  it('keeps the text of an input group without clearOnSubmit', async () => {
    const user = userEvent.setup();
    renderView([{ ...addPlayer, clearOnSubmit: undefined } as GamemasterControl]);
    const field = screen.getByLabelText('Spieler hinzufügen');
    await user.type(field, 'Jojo{Enter}');
    expect(field).toHaveValue('Jojo');
  });

  it('ArrowDown in the empty field shows the whole list, without disabled players', async () => {
    const user = userEvent.setup();
    const withDisabled: GamemasterControl = {
      ...addPlayer,
      inputs: [{
        ...(addPlayer as Extract<GamemasterControl, { type: 'input-group' }>).inputs[0]!,
        suggestions: [
          ...(addPlayer as Extract<GamemasterControl, { type: 'input-group' }>).inputs[0]!.suggestions!,
          { id: 'old', label: 'Olga Alt', fullMatch: ['Olga', 'Alt', 'Olga Alt'] },
        ],
      }],
    };
    renderView([withDisabled]);
    const field = screen.getByLabelText('Spieler hinzufügen');
    await user.click(field);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    const options = screen.getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['Michael „Michi“ Huber', 'Michaela „Michi“ Pichler', 'Johanna Berger']);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    // Arrowing on moves through the whole list; Enter fills the entry in.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(field).toHaveValue('Johanna Berger');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('typing after ArrowDown goes back to filtering; Escape closes the whole list', async () => {
    const user = userEvent.setup();
    renderView();
    const field = screen.getByLabelText('Spieler hinzufügen');
    await user.click(field);
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    await user.type(field, 'pich');
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Michaela „Michi“ Pichler']);
  });

  it('a click into the already focused field shows the whole list, like ArrowDown', async () => {
    const user = userEvent.setup();
    renderView();
    const field = screen.getByLabelText('Spieler hinzufügen');
    // The click that focuses the field only places the caret.
    await user.click(field);
    expect(field).toHaveFocus();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    await user.click(field);
    const options = screen.getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['Michael „Michi“ Huber', 'Michaela „Michi“ Pichler', 'Johanna Berger']);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(field).toHaveValue('Michael „Michi“ Huber');
  });

  it('a click into the field keeps a filtered list as it is', async () => {
    const user = userEvent.setup();
    renderView();
    const field = screen.getByLabelText('Spieler hinzufügen');
    await user.type(field, 'pich');
    await user.click(field);
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Michaela „Michi“ Pichler']);
  });
});
