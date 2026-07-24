import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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

function renderWithControls(controls: GamemasterControl[]) {
  mockControls.current = { controls };
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

function inputGroup(value: string, emitOnChange: boolean): GamemasterControl[] {
  return [{
    type: 'input-group',
    id: 'assign-teams',
    inputs: [{ id: 'names', label: 'Namen', inputType: 'text', value, emitOnChange }],
    submitLabel: 'Teams zuweisen',
  }];
}

describe('GamemasterView — InputGroupControl value seeding', () => {
  beforeEach(() => {
    mockAnswer.current = { gameTitle: 'T', answer: '', questionNumber: 1, totalQuestions: 5 };
    mockControls.current = null;
  });

  it('re-seeds a non-emitOnChange input when a late-arriving value changes', () => {
    // Mimics the assign-teams roster loading async after the control has mounted:
    // first broadcast empty, then re-broadcast with the prefilled roster.
    const { rerender } = renderWithControls(inputGroup('', false));
    const field = () => document.querySelector<HTMLInputElement>('input.gm-input')!;
    expect(field().value).toBe('');

    mockControls.current = { controls: inputGroup('Alice, Bob, Charlie', false) };
    rerender(
      <MemoryRouter>
        <ThemeProvider>
          <GameProvider>
            <GamemasterView />
          </GameProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
    expect(field().value).toBe('Alice, Bob, Charlie');
  });

  it('does NOT re-seed an emitOnChange input on a value change (GM keeps its typing)', () => {
    // emitOnChange controls round-trip through the show; the GM owns the value
    // while typing, so an echoed/lagging server value must not clobber it.
    const { rerender } = renderWithControls(inputGroup('', true));
    const field = () => document.querySelector<HTMLInputElement>('input.gm-input')!;

    fireEvent.change(field(), { target: { value: '5' } });
    expect(field().value).toBe('5');

    // A later broadcast carries a stale/different value — must be ignored.
    mockControls.current = { controls: inputGroup('3', true) };
    rerender(
      <MemoryRouter>
        <ThemeProvider>
          <GameProvider>
            <GamemasterView />
          </GameProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
    expect(field().value).toBe('5');
  });
});
