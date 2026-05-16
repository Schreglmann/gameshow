import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterView from '@/components/common/GamemasterView';
import type { GamemasterControl, GamemasterControlsData } from '@/types/game';

const mockAnswer: { current: unknown } = {
  current: { gameTitle: 'T', answer: '', questionNumber: 1, totalQuestions: 5 },
};
const mockControls: { current: GamemasterControlsData | null } = { current: null };

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => mockAnswer.current,
  useGamemasterControls: () => mockControls.current,
  useSendGamemasterCommand: () => () => {},
}));

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: [],
  }),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));

function renderWithNav(nav: Extract<GamemasterControl, { type: 'nav' }>) {
  mockControls.current = { controls: [nav] };
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterView />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('GamemasterView — NavControl visibility', () => {
  beforeEach(() => {
    mockAnswer.current = { gameTitle: 'T', answer: '', questionNumber: 1, totalQuestions: 5 };
    mockControls.current = null;
  });

  it('shows both Zurück and Weiter by default', () => {
    renderWithNav({ type: 'nav', id: 'nav' });
    expect(document.querySelector('.gm-nav-row')).not.toBeNull();
    expect(document.body.textContent).toContain('Zurück');
    expect(document.body.textContent).toContain('Weiter');
  });

  it('hides Zurück when hideBack is true', () => {
    renderWithNav({ type: 'nav', id: 'nav', hideBack: true });
    expect(document.querySelector('.gm-nav-row')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Zurück');
    expect(document.body.textContent).toContain('Weiter');
  });

  it('hides Weiter when hideForward is true', () => {
    renderWithNav({ type: 'nav', id: 'nav', hideForward: true });
    expect(document.querySelector('.gm-nav-row')).not.toBeNull();
    expect(document.body.textContent).toContain('Zurück');
    expect(document.body.textContent).not.toContain('Weiter');
  });

  it('renders no nav row at all when both hideBack and hideForward are true', () => {
    renderWithNav({ type: 'nav', id: 'nav', hideBack: true, hideForward: true });
    expect(document.querySelector('.gm-nav-row')).toBeNull();
    expect(document.body.textContent).not.toContain('Zurück');
    expect(document.body.textContent).not.toContain('Weiter');
  });
});
