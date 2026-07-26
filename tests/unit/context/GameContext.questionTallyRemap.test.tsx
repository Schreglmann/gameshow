import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { GameProvider, useGameContext } from '@/context/GameContext';
import type { CorrectAnswersMap } from '@/types/game';
import { __clearWsCacheForTests } from '@/services/useBackendSocket';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    teamMirrorEnabled: true,
    globalRules: [],
  }),
}));

const STORAGE_KEY = 'correctAnswersByQuestion';

/**
 * Live question edits shift a game's question indices, and the correct-answer
 * tally is keyed by index — see specs/gamemaster-question-scores.md and
 * specs/live-question-order.md.
 */
async function setup(initial: CorrectAnswersMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  let ctx: ReturnType<typeof useGameContext> | null = null;
  function Probe() {
    ctx = useGameContext();
    return null;
  }
  // Awaited so the settings fetch settles inside act() — otherwise every test
  // logs an "update was not wrapped in act" warning from GameProvider's mount.
  await act(async () => { render(<GameProvider><Probe /></GameProvider>); });
  return {
    remap: (gameIndex: number, moved: (number | null)[]) =>
      act(() => { ctx!.dispatch({ type: 'REMAP_QUESTION_TALLY', payload: { gameIndex, moved } }); }),
    tally: () => ctx!.state.correctAnswersByGame,
    stored: () => JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'),
  };
}

describe('REMAP_QUESTION_TALLY', () => {
  beforeEach(() => {
    localStorage.clear();
    __clearWsCacheForTests();
  });

  it('shifts buckets down when an earlier question is deleted', async () => {
    const { remap, tally, stored } = await setup({
      '0': { '1': { team1: 1, team2: 0 }, '3': { team1: 2, team2: 1 } },
    });
    // Play index 2 was deleted: 3 → 2.
    remap(0, [0, 1, null, 2]);

    expect(tally()['0']).toEqual({ '1': { team1: 1, team2: 0 }, '2': { team1: 2, team2: 1 } });
    expect(stored()['0']).toEqual({ '1': { team1: 1, team2: 0 }, '2': { team1: 2, team2: 1 } });
  });

  it('moves a deleted question’s counts to the none bucket, not onto its neighbour', async () => {
    const { remap, tally } = await setup({
      '0': { '2': { team1: 3, team2: 0 }, '3': { team1: 1, team2: 1 } },
    });
    remap(0, [0, 1, null, 2]);

    expect(tally()['0']).toEqual({
      none: { team1: 3, team2: 0 },
      '2': { team1: 1, team2: 1 },
    });
  });

  it('merges into an existing none bucket rather than overwriting it', async () => {
    const { remap, tally } = await setup({
      '0': { none: { team1: 1, team2: 1 }, '1': { team1: 2, team2: 0 } },
    });
    remap(0, [0, null]);

    expect(tally()['0']).toEqual({ none: { team1: 3, team2: 1 } });
  });

  it('leaves other games untouched', async () => {
    const { remap, tally } = await setup({
      '0': { '2': { team1: 1, team2: 0 } },
      '1': { '2': { team1: 5, team2: 5 } },
    });
    remap(0, [0, 1, null]);

    expect(tally()['1']).toEqual({ '2': { team1: 5, team2: 5 } });
  });

  it('is a no-op when nothing moved', async () => {
    const { remap, tally } = await setup({ '0': { '1': { team1: 1, team2: 0 } } });
    const before = tally();
    remap(0, [0, 1, 2]);
    expect(tally()).toBe(before); // same reference — no re-render, no WS re-broadcast
  });

  it('is a no-op for a game with no tally yet', async () => {
    const { remap, tally } = await setup({ '0': { '1': { team1: 1, team2: 0 } } });
    const before = tally();
    remap(7, [0, null]);
    expect(tally()).toBe(before);
  });

  it('keeps keys beyond the mapped range where they are', async () => {
    const { remap, tally } = await setup({ '0': { '9': { team1: 1, team2: 0 } } });
    remap(0, [0, 1]);
    expect(tally()['0']).toEqual({ '9': { team1: 1, team2: 0 } });
  });
});
