import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
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

  function rerenderView(rerender: (ui: ReactElement) => void) {
    rerender(
      <MemoryRouter>
        <ThemeProvider>
          <GameProvider>
            <GamemasterView />
          </GameProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
  }

  it('re-seeds an unfocused input when a value arrives after mount (async prefill / mirror)', () => {
    // Mimics the assign-teams roster loading async after the control has mounted:
    // first broadcast empty, then re-broadcast with the prefilled roster. emitOnChange
    // is on (bidirectional mirror) — an unfocused field must still pick up the value.
    const { rerender } = renderWithControls(inputGroup('', true));
    const field = () => document.querySelector<HTMLInputElement>('input.gm-input')!;
    expect(field().value).toBe('');

    mockControls.current = { controls: inputGroup('Alice, Bob, Charlie', true) };
    rerenderView(rerender);
    expect(field().value).toBe('Alice, Bob, Charlie');
  });

  it('does NOT re-seed while the field is focused (GM typing is never clobbered)', () => {
    // The GM owns the value while focused; a lagging echoed broadcast must be ignored.
    const { rerender } = renderWithControls(inputGroup('', true));
    const field = () => document.querySelector<HTMLInputElement>('input.gm-input')!;

    act(() => { field().focus(); });
    fireEvent.change(field(), { target: { value: '5' } });
    expect(field().value).toBe('5');

    // A later broadcast carries a stale/different value — must be ignored while focused.
    mockControls.current = { controls: inputGroup('3', true) };
    rerenderView(rerender);
    expect(field().value).toBe('5');

    // Once focus is released, a subsequent external value change re-seeds again.
    act(() => { field().blur(); });
    mockControls.current = { controls: inputGroup('Alice, Bob', true) };
    rerenderView(rerender);
    expect(field().value).toBe('Alice, Bob');
  });
});
