// A GM button carrying a `menu` opens a popover next to itself instead of
// sending its own id. See specs/team-management.md ("GM button menu").
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

const CONTROLS: GamemasterControl[] = [{
  type: 'button-group',
  id: 'draw-team1',
  label: 'Team 1 (2)',
  buttons: [
    {
      id: 'player-team1-0',
      label: 'Anna',
      menu: [
        { id: 'mvto-team1-0-team2', label: '→ Team 2' },
        { id: 'rm-team1-0', label: 'Entfernen', variant: 'danger' },
      ],
    },
    { id: 'plain', label: 'Ohne Menü' },
  ],
}];

function renderView(onOverlayActiveChange = vi.fn()) {
  mockControls.current = { controls: CONTROLS };
  render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterView onOverlayActiveChange={onOverlayActiveChange} />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  return onOverlayActiveChange;
}

describe('GamemasterView — button menu', () => {
  beforeEach(() => {
    sent.mockClear();
    document.body.innerHTML = '';
  });

  it('opens the popover instead of sending the button id', () => {
    const overlay = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Anna' }));
    expect(sent).not.toHaveBeenCalled();
    const menu = screen.getByRole('menu', { name: 'Anna' });
    expect(menu).toHaveAttribute('data-gm-no-nav');
    // Portalled out of the controls panel, so no transformed ancestor clips it.
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getAllByRole('menuitem').map(b => b.textContent)).toEqual(['→ Team 2', 'Entfernen']);
    expect(overlay).toHaveBeenLastCalledWith(true);
  });

  it('sends the chosen entry and closes', () => {
    const overlay = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Anna' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Entfernen' }));
    expect(sent).toHaveBeenCalledWith('rm-team1-0');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(overlay).toHaveBeenLastCalledWith(false);
  });

  it('closes on a backdrop tap or Escape without sending anything', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Anna' }));
    const backdrop = document.querySelector('.gm-menu-backdrop')!;
    expect(backdrop).toHaveAttribute('data-gm-no-nav');
    fireEvent.click(backdrop);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Anna' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });

  it('draws a group with `team` + `layout: grid` as a team card with a cell grid', () => {
    mockControls.current = {
      controls: [{ ...CONTROLS[0]!, team: 'team2', layout: 'grid' } as GamemasterControl],
    };
    render(
      <MemoryRouter>
        <ThemeProvider>
          <GameProvider>
            <GamemasterView />
          </GameProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    const group = document.querySelector('.gm-button-group')!;
    expect(group).toHaveClass('gm-button-group--team');
    expect(group).toHaveAttribute('data-team', 'team2');
    expect(group.querySelector('.gm-group-label .team-dot')).not.toBeNull();
    expect(group.querySelector('.gm-button-row')).toHaveClass('gm-button-row--grid');
  });

  it('leaves buttons without a menu unchanged', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Menü' }));
    expect(sent).toHaveBeenCalledWith('plain');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
