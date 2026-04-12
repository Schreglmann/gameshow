import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import Bandle from '@/components/games/Bandle';
import type { BandleConfig } from '@/types/config';

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

function makeConfig(overrides: Partial<BandleConfig> = {}): BandleConfig {
  return {
    type: 'bandle',
    title: 'Bandle Quiz',
    rules: ['Erkennt den Song anhand der Instrumente.'],
    questions: [
      {
        answer: 'Example - Artist',
        tracks: [
          { label: 'Schlagzeug', audio: '/audio/bandle/example/track1.mp3' },
          { label: 'Bass', audio: '/audio/bandle/example/track2.mp3' },
          { label: 'Gitarre', audio: '/audio/bandle/example/track3.mp3' },
        ],
        isExample: true,
      },
      {
        answer: 'Song 1 - Artist 1',
        tracks: [
          { label: 'Drums', audio: '/audio/bandle/song1/track1.mp3' },
          { label: 'Bass', audio: '/audio/bandle/song1/track2.mp3' },
          { label: 'Synth', audio: '/audio/bandle/song1/track3.mp3' },
          { label: 'Voice', audio: '/audio/bandle/song1/track4.mp3' },
        ],
      },
      {
        answer: 'Song 2 - Artist 2',
        tracks: [
          { label: 'Percussion', audio: '/audio/bandle/song2/track1.mp3' },
          { label: 'Guitar', audio: '/audio/bandle/song2/track2.mp3' },
        ],
      },
    ],
    ...overrides,
  };
}

function renderGame(config?: BandleConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <Bandle {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

/** Simulate a short press of ArrowRight (keydown + keyup) — required because
 *  BandleInner intercepts ArrowRight in capture phase for long-press detection. */
function pressArrowRight() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
  });
}

async function advanceToGame(_user: ReturnType<typeof userEvent.setup>) {
  // Landing -> Rules
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
  // Rules -> Game
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
}

describe('Bandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Bandle Quiz')).toBeInTheDocument();
    });
  });

  it('shows example label for first question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
    });
  });

  it('shows track indicators with first track revealed', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      // First track label should be visible (revealed)
      expect(screen.getByText('Schlagzeug')).toBeInTheDocument();
      // Other tracks should show '?'
      expect(screen.getByText('Stufe 2')).toBeInTheDocument();
      expect(screen.getByText('Stufe 3')).toBeInTheDocument();
    });
  });

  it('highlights stage 1 after going back from stage 2', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Stage 1: track 0 should be active
    await waitFor(() => {
      const track0 = screen.getByText('Schlagzeug').closest('.bandle-track')!;
      expect(track0.className).toContain('active');
    });

    // ArrowRight → stage 2
    pressArrowRight();

    await waitFor(() => {
      const track1 = screen.getByText('Bass').closest('.bandle-track')!;
      expect(track1.className).toContain('active');
      // Track 0 should NOT be active
      const track0 = screen.getByText('Schlagzeug').closest('.bandle-track')!;
      expect(track0.className).not.toContain('active');
    });

    // ArrowLeft → back to stage 1
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    });

    await waitFor(() => {
      const track0 = screen.getByText('Schlagzeug').closest('.bandle-track')!;
      expect(track0.className).toContain('active');
      // Track 1 should be hidden (not revealed) — shows "?" not "Bass"
      const allTracks = document.querySelectorAll('.bandle-track');
      expect(allTracks[1]!.className).toContain('hidden');
      expect(allTracks[1]!.className).not.toContain('active');
    });
  });

  it('shows audio control buttons (play, restart) and answer pill', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByLabelText('Abspielen')).toBeInTheDocument();
      expect(screen.getByLabelText('Von vorne abspielen')).toBeInTheDocument();
      expect(screen.getByLabelText('Auflösen')).toBeInTheDocument();
    });
  });

  it('reveals answer when clicking Auflösen', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Answer not visible initially
    expect(screen.queryByText('Example - Artist')).not.toBeInTheDocument();

    // Click Auflösen
    await waitFor(() => expect(screen.getByLabelText('Auflösen')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Auflösen'));

    await waitFor(() => {
      expect(screen.getByText('Example - Artist')).toBeInTheDocument();
    });
  });

  it('keeps audio controls visible after answer reveal', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Auflösen')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Auflösen'));

    await waitFor(() => {
      expect(screen.getByLabelText('Abspielen')).toBeInTheDocument();
      expect(screen.getByLabelText('Auflösen')).toBeInTheDocument();
      expect(screen.getByText('Auflösung')).toBeInTheDocument();
    });
  });

  it('renders audio element', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      const audioElements = document.querySelectorAll('audio');
      expect(audioElements.length).toBe(1);
    });
  });

  it('shows question numbering for non-example questions', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Reveal answer on example, then advance to next
    await waitFor(() => expect(screen.getByLabelText('Auflösen')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Auflösen'));

    // Advance to next question via keyboard
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    await waitFor(() => {
      expect(screen.getByText('Song 1 von 2')).toBeInTheDocument();
    });
  });

  it('shows hint stage before answer when question has hint enabled', async () => {
    const config = makeConfig({
      questions: [
        {
          answer: 'Test Song - Test Artist',
          tracks: [
            { label: 'Drums', audio: '/audio/bandle/test/track1.mp3' },
            { label: 'Bass', audio: '/audio/bandle/test/track2.mp3' },
          ],
          hint: 'Erschienen 1985',
          hintEnabled: true,
          isExample: true,
        },
      ],
    });
    const user = userEvent.setup();
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Initially: track 1 revealed, hint not visible
    await waitFor(() => expect(screen.getByText('Drums')).toBeInTheDocument());
    expect(screen.queryByText('Erschienen 1985')).not.toBeInTheDocument();

    // Advance to reveal track 2
    pressArrowRight();

    // Advance again → should show hint (not answer)
    pressArrowRight();

    await waitFor(() => {
      expect(screen.getByText('Erschienen 1985')).toBeInTheDocument();
      // Answer should NOT be visible yet
      expect(screen.queryByText('Test Song - Test Artist')).not.toBeInTheDocument();
    });

    // Advance once more → should show answer
    pressArrowRight();

    await waitFor(() => {
      expect(screen.getByText('Test Song - Test Artist')).toBeInTheDocument();
    });
  });

  it('shows Hinweis pill in track indicators when hint is enabled', async () => {
    const config = makeConfig({
      questions: [
        {
          answer: 'Song',
          tracks: [{ label: 'Drums', audio: '/audio/t1.mp3' }],
          hint: 'A hint',
          hintEnabled: true,
          isExample: true,
        },
      ],
    });
    const user = userEvent.setup();
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // The hint pill should show "Stufe 2" (after the single audio track)
    await waitFor(() => {
      expect(screen.getByText('Stufe 2')).toBeInTheDocument();
    });
  });

  it('skips hint stage when hint exists but hintEnabled is false', async () => {
    const config = makeConfig({
      questions: [
        {
          answer: 'Hint Disabled Song',
          tracks: [
            { label: 'Drums', audio: '/audio/t1.mp3' },
          ],
          hint: 'This hint should not show',
          isExample: true,
        },
      ],
    });
    const user = userEvent.setup();
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Only one track, advance → should go straight to answer (hint not enabled)
    pressArrowRight();

    await waitFor(() => {
      expect(screen.getByText('Hint Disabled Song')).toBeInTheDocument();
      expect(screen.queryByText('This hint should not show')).not.toBeInTheDocument();
    });
  });

  it('skips hint stage when question has no hint', async () => {
    const config = makeConfig({
      questions: [
        {
          answer: 'No Hint Song',
          tracks: [
            { label: 'Drums', audio: '/audio/t1.mp3' },
          ],
          isExample: true,
        },
      ],
    });
    const user = userEvent.setup();
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Only one track, advance → should go straight to answer (no hint)
    pressArrowRight();

    await waitFor(() => {
      expect(screen.getByText('No Hint Song')).toBeInTheDocument();
    });
  });

  it('filters out disabled questions', async () => {
    const config = makeConfig({
      questions: [
        {
          answer: 'Example',
          tracks: [{ label: 'Drums', audio: '/audio/t1.mp3' }],
          isExample: true,
        },
        {
          answer: 'Disabled Song',
          tracks: [{ label: 'Drums', audio: '/audio/t1.mp3' }],
          disabled: true,
        },
        {
          answer: 'Active Song',
          tracks: [{ label: 'Drums', audio: '/audio/t1.mp3' }],
        },
      ],
    });
    const user = userEvent.setup();
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Bandle Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Reveal + advance past example
    await waitFor(() => expect(screen.getByLabelText('Auflösen')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Auflösen'));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    await waitFor(() => {
      // Should show "Song 1 von 1" since disabled is filtered out
      expect(screen.getByText('Song 1 von 1')).toBeInTheDocument();
    });
  });
});
