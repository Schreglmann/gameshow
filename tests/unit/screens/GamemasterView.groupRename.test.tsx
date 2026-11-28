// A button group with `rename` makes its label (the team name on a start-screen
// team card) editable in place. See specs/team-management.md ("Optional team names").
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterView from '@/components/common/GamemasterView';
import type { GamemasterControl, GamemasterControlsData } from '@/types/game';

const mockControls: { current: GamemasterControlsData | null } = { current: null };
const sent = vi.fn();

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => ({ gameTitle: 'T', answer: '', questionNumber: 0, totalQuestions: 0 }),
  useGamemasterControls: () => mockControls.current,
  useSendGamemasterCommand: () => sent,
  requestShowReemit: () => {},
}));

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({ pointSystemEnabled: true, teamRandomizationEnabled: true, globalRules: [] }),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));

function card(hint?: string): GamemasterControl[] {
  return [{
    type: 'button-group',
    id: 'draw-team1',
    label: 'Füchse (2)',
    layout: 'grid',
    team: 'team1',
    rename: { id: 'team-name-team1', value: 'Füchse', placeholder: 'Team 1', ariaLabel: 'Name Team 1', ...(hint ? { hint } : {}) },
    buttons: [{ id: 'player-team1-0', label: 'Anna' }],
  }];
}

function renderView(controls = card()) {
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

const openEditor = () => fireEvent.click(screen.getByRole('button', { name: 'Name Team 1 ändern' }));
const input = () => screen.getByRole('textbox', { name: 'Name Team 1' }) as HTMLInputElement;

beforeEach(() => {
  sent.mockClear();
});

describe('editable team-card name on the GM', () => {
  it('shows the name with its count as a button, not a plain label', () => {
    renderView();
    expect(screen.getByRole('button', { name: 'Name Team 1 ändern' }).textContent).toContain('Füchse (2)');
  });

  it('opens an input with the current name and mirrors the draft', () => {
    renderView();
    openEditor();
    expect(input().value).toBe('Füchse');
    expect(sent).toHaveBeenLastCalledWith('team-name-team1:change', { name: 'Füchse' });
    fireEvent.change(input(), { target: { value: 'Wölfe' } });
    expect(sent).toHaveBeenLastCalledWith('team-name-team1:change', { name: 'Wölfe' });
  });

  it('saves with Enter and closes the input', () => {
    renderView();
    openEditor();
    fireEvent.change(input(), { target: { value: 'Wölfe' } });
    fireEvent.submit(input().form!);
    expect(sent).toHaveBeenLastCalledWith('team-name-team1', { name: 'Wölfe' });
    expect(screen.queryByRole('textbox', { name: 'Name Team 1' })).toBeNull();
  });

  it('saves on a tap on empty space, which does not reach the advance-the-show handler', () => {
    // GamemasterScreen advances the show from a document click listener.
    const advance = vi.fn();
    document.addEventListener('click', advance);
    try {
      renderView();
      openEditor();
      advance.mockClear();
      fireEvent.change(input(), { target: { value: 'Wölfe' } });
      fireEvent.click(document.body);
      expect(sent).toHaveBeenLastCalledWith('team-name-team1', { name: 'Wölfe' });
      expect(screen.queryByRole('textbox', { name: 'Name Team 1' })).toBeNull();
      expect(advance).not.toHaveBeenCalled();
      // With the editor closed, empty space advances again.
      fireEvent.click(document.body);
      expect(advance).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('click', advance);
    }
  });

  it('saves on a tap on another control, and that control still gets the tap', () => {
    renderView();
    openEditor();
    fireEvent.change(input(), { target: { value: 'Wölfe' } });
    sent.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Anna' }));
    expect(sent.mock.calls).toEqual([
      ['team-name-team1', { name: 'Wölfe' }],
      ['player-team1-0'],
    ]);
  });

  it('does not save when the input merely loses focus (iPad keyboard dismissed)', () => {
    renderView();
    openEditor();
    fireEvent.change(input(), { target: { value: 'Wölfe' } });
    fireEvent.blur(input());
    expect(sent).not.toHaveBeenCalledWith('team-name-team1', expect.anything());
    expect(input().value).toBe('Wölfe');
  });

  it('gives the iPad keyboard a "Fertig" key and no autofill', () => {
    renderView();
    openEditor();
    expect(input().getAttribute('enterkeyhint')).toBe('done');
    expect(input().getAttribute('autocomplete')).toBe('off');
  });

  it('cancels with Escape or ✕ without sending a name', () => {
    renderView();
    openEditor();
    fireEvent.change(input(), { target: { value: 'Wölfe' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Name Team 1' })).toBeNull();
    openEditor();
    fireEvent.change(input(), { target: { value: 'Bären' } });
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('textbox', { name: 'Name Team 1' })).toBeNull();
    expect(sent).not.toHaveBeenCalledWith('team-name-team1', expect.anything());
  });

  it('sends nothing when the name is saved unchanged', () => {
    renderView();
    openEditor();
    fireEvent.submit(input().form!);
    expect(sent).not.toHaveBeenCalledWith('team-name-team1', expect.anything());
  });

  it('shows the hint from the show under the input while editing', () => {
    const { rerender } = renderView();
    openEditor();
    expect(screen.queryByRole('status')).toBeNull();
    mockControls.current = { controls: card('Name ist zu lang') };
    rerender(
      <MemoryRouter>
        <ThemeProvider>
          <GameProvider>
            <GamemasterView />
          </GameProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Name ist zu lang')).toBeTruthy();
  });
});
