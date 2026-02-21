import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MusicControls from '@/components/layout/MusicControls';
import type { MusicPlayerControls } from '@/hooks/useBackgroundMusic';

function createMockPlayer(overrides: Partial<MusicPlayerControls> = {}): MusicPlayerControls {
  return {
    isPlaying: false,
    currentSong: '',
    currentTime: 0,
    duration: 0,
    volume: 0.2,
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    skipToNext: vi.fn(),
    setVolume: vi.fn(),
    fadeOut: vi.fn(),
    fadeIn: vi.fn(),
    seekTo: vi.fn(),
    ...overrides,
  };
}

describe('MusicControls interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls start when play button is clicked and not playing', async () => {
    const user = userEvent.setup();
    const player = createMockPlayer({ isPlaying: false });
    render(<MusicControls player={player} />);

    const playButton = screen.getAllByRole('button').find(b => b.textContent === '▶');
    expect(playButton).toBeTruthy();
    await user.click(playButton!);

    expect(player.start).toHaveBeenCalledTimes(1);
  });

  it('calls pause when pause button is clicked while playing', async () => {
    const user = userEvent.setup();
    const player = createMockPlayer({ isPlaying: true, currentSong: 'Song' });
    render(<MusicControls player={player} />);

    const pauseButton = screen.getAllByRole('button').find(b => b.textContent === '⏸');
    expect(pauseButton).toBeTruthy();
    await user.click(pauseButton!);

    expect(player.pause).toHaveBeenCalledTimes(1);
  });

  it('calls skipToNext when skip button is clicked', async () => {
    const user = userEvent.setup();
    const player = createMockPlayer({ isPlaying: true, currentSong: 'Song' });
    render(<MusicControls player={player} />);

    const skipButton = screen.getAllByRole('button').find(b => b.textContent === '⏭');
    expect(skipButton).toBeTruthy();
    await user.click(skipButton!);

    expect(player.skipToNext).toHaveBeenCalledTimes(1);
  });

  it('calls setVolume when volume slider changes', async () => {
    const user = userEvent.setup();
    const player = createMockPlayer({ volume: 0.5 });
    render(<MusicControls player={player} />);

    const slider = document.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).toBeInTheDocument();

    // fireEvent is more reliable for range inputs
    fireEvent.change(slider, { target: { value: '75' } });

    expect(player.setVolume).toHaveBeenCalled();
  });

  it('displays current song name', () => {
    const player = createMockPlayer({
      isPlaying: true,
      currentSong: 'My Awesome Track',
    });
    render(<MusicControls player={player} />);

    const songNameEl = document.querySelector('.song-name');
    expect(songNameEl).toBeInTheDocument();
    expect(songNameEl!.getAttribute('data-text')).toBe('My Awesome Track');
  });
});
