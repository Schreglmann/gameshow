import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGamemasterSync } from '@/hooks/useGamemasterSync';
import { setInactiveShowTab } from '@/services/showPresenceState';
import type { GamemasterAnswerData } from '@/types/game';

// Spy on the raw WS send so we can count actual `gamemaster-answer` broadcasts.
const { sendWs } = vi.hoisted(() => ({ sendWs: vi.fn() }));

vi.mock('@/services/useBackendSocket', () => ({
  sendWs: (channel: string, data: unknown) => sendWs(channel, data),
  sendWsControl: vi.fn(),
  onWsOpen: () => () => {},
  useWsChannel: () => {},
}));

function answer(label: string): GamemasterAnswerData {
  return { gameTitle: 'Game Show', answer: '', questionNumber: 0, totalQuestions: 0, screenLabel: label };
}

describe('useGamemasterSync — content-guarded answer emit', () => {
  beforeEach(() => {
    sendWs.mockClear();
    setInactiveShowTab(false);
  });

  it('does NOT re-broadcast when a referentially-new but content-identical object is passed', () => {
    // Regression for the live-show bug: HomeScreen passes a fresh literal on
    // every render, so a reference-keyed effect would re-emit "Startseite" on
    // every unrelated state change and clobber the gamemaster card mid-game.
    const { rerender } = renderHook(({ data }) => useGamemasterSync(data), {
      initialProps: { data: answer('Startseite') },
    });
    expect(sendWs).toHaveBeenCalledTimes(1);

    rerender({ data: answer('Startseite') }); // new object, identical content
    rerender({ data: answer('Startseite') });
    expect(sendWs).toHaveBeenCalledTimes(1);
  });

  it('still re-broadcasts on a genuine content change', () => {
    const { rerender } = renderHook(({ data }) => useGamemasterSync(data), {
      initialProps: { data: answer('Startseite') },
    });
    expect(sendWs).toHaveBeenCalledTimes(1);

    rerender({ data: answer('Titel') });
    expect(sendWs).toHaveBeenCalledTimes(2);
    expect(sendWs).toHaveBeenLastCalledWith(
      'gamemaster-answer',
      expect.objectContaining({ screenLabel: 'Titel' }),
    );
  });
});
