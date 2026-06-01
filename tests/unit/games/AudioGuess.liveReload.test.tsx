import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import AudioGuess from '@/components/games/AudioGuess';
import type { AudioGuessConfig } from '@/types/config';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

const defaultProps = {
  gameId: 'game-1',
  currentIndex: 0,
  totalGames: 5,
  pointSystemEnabled: true,
  onNextGame: vi.fn(),
  onAwardPoints: vi.fn(),
};

function makeConfig(questions: AudioGuessConfig['questions']): AudioGuessConfig {
  return { type: 'audio-guess', title: 'Audio Quiz', rules: ['Listen and guess'], questions };
}

function tree(config: AudioGuessConfig) {
  return (
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <AudioGuess {...defaultProps} config={config} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

function advanceToGame() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); }); // landing → rules
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); }); // rules → game
}

const ORIGINAL = [
  { answer: 'Example Song', audio: '/audio/example.m4a', isExample: true },
  { answer: 'Song 1', audio: '/audio/song1.m4a' },
];

describe('AudioGuess — live media reload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('reloads the audio element when the CURRENT question audio URL is edited live', async () => {
    const { rerender } = render(tree(makeConfig(ORIGINAL)));
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      const audios = document.querySelectorAll('audio');
      expect(audios[0].getAttribute('src')).toBe('/audio/example.m4a');
    });

    // Live edit: the current (example) question's audio path is fixed on disk.
    rerender(tree(makeConfig([
      { answer: 'Example Song', audio: '/audio/example-fixed.m4a', isExample: true },
      { answer: 'Song 1', audio: '/audio/song1.m4a' },
    ])));

    await waitFor(() => {
      const audios = document.querySelectorAll('audio');
      expect(audios[0].getAttribute('src')).toBe('/audio/example-fixed.m4a');
      expect(audios[1].getAttribute('src')).toBe('/audio/example-fixed.m4a');
    });
  });

  it('does NOT reload when a NON-current question audio URL changes', async () => {
    const { rerender } = render(tree(makeConfig(ORIGINAL)));
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      expect(document.querySelectorAll('audio')[0].getAttribute('src')).toBe('/audio/example.m4a');
    });

    // Edit only the NEXT question's audio — the current one is untouched.
    rerender(tree(makeConfig([
      { answer: 'Example Song', audio: '/audio/example.m4a', isExample: true },
      { answer: 'Song 1', audio: '/audio/song1-fixed.m4a' },
    ])));

    // Current audio element stays on the original example clip (no spurious reload).
    expect(document.querySelectorAll('audio')[0].getAttribute('src')).toBe('/audio/example.m4a');
  });
});
