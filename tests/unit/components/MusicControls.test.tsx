import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('MusicControls', () => {
  it('renders the toggle button', () => {
    const player = createMockPlayer();
    render(<MusicControls player={player} />);
    // The toggle button shows ◀ when hidden
    expect(document.querySelector('.music-toggle')).toBeInTheDocument();
  });

  it('shows play button when not playing', () => {
    const player = createMockPlayer({ isPlaying: false });
    render(<MusicControls player={player} />);
    // Find the play/pause button
    const buttons = screen.getAllByRole('button');
    const playButton = buttons.find(b => b.textContent === '▶');
    expect(playButton).toBeTruthy();
  });

  it('shows pause button when playing', () => {
    const player = createMockPlayer({ isPlaying: true, currentSong: 'Test' });
    render(<MusicControls player={player} />);
    const buttons = screen.getAllByRole('button');
    const pauseButton = buttons.find(b => b.textContent === '⏸');
    expect(pauseButton).toBeTruthy();
  });

  it('renders volume slider', () => {
    const player = createMockPlayer({ volume: 0.5 });
    render(<MusicControls player={player} />);
    const slider = document.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(slider.value).toBe('50');
  });

  it('renders skip button', () => {
    const player = createMockPlayer();
    render(<MusicControls player={player} />);
    const buttons = screen.getAllByRole('button');
    const skipButton = buttons.find(b => b.textContent === '⏭');
    expect(skipButton).toBeTruthy();
  });

  it('formats time correctly', () => {
    const player = createMockPlayer({
      isPlaying: true,
      currentTime: 65,
      duration: 180,
      currentSong: 'Test Song',
    });
    render(<MusicControls player={player} />);
    expect(screen.getByText('1:05 / 3:00')).toBeInTheDocument();
  });

  it('shows 0:00 / 0:00 when no song is loaded', () => {
    const player = createMockPlayer();
    render(<MusicControls player={player} />);
    expect(screen.getByText('0:00 / 0:00')).toBeInTheDocument();
  });
});
