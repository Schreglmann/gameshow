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

describe('MusicControls - Gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('becomes visible on mouseEnter of toggle button', async () => {
    const player = createMockPlayer();
    render(<MusicControls player={player} />);

    const toggle = document.querySelector('.music-toggle')!;
    fireEvent.mouseEnter(toggle);

    expect(document.querySelector('.music-controls.visible')).toBeInTheDocument();
  });

  it('hides on click outside', async () => {
    const player = createMockPlayer();
    render(<MusicControls player={player} />);

    // Show controls
    const toggle = document.querySelector('.music-toggle')!;
    fireEvent.mouseEnter(toggle);
    expect(document.querySelector('.music-controls.visible')).toBeInTheDocument();

    // Click outside
    fireEvent.click(document.body);

    expect(document.querySelector('.music-controls.visible')).not.toBeInTheDocument();
  });

  it('calls resume when play is clicked with existing currentSong', async () => {
    const user = userEvent.setup();
    const player = createMockPlayer({ isPlaying: false, currentSong: 'Some Track' });
    render(<MusicControls player={player} />);

    // Show controls first
    fireEvent.mouseEnter(document.querySelector('.music-toggle')!);

    // Find play button (▶)
    const playButton = screen.getByTitle('Play/Pause');
    await user.click(playButton);

    expect(player.resume).toHaveBeenCalled();
    expect(player.start).not.toHaveBeenCalled();
  });

  it('calls start when play is clicked with no currentSong', async () => {
    const user = userEvent.setup();
    const player = createMockPlayer({ isPlaying: false, currentSong: '' });
    render(<MusicControls player={player} />);

    fireEvent.mouseEnter(document.querySelector('.music-toggle')!);
    const playButton = screen.getByTitle('Play/Pause');
    await user.click(playButton);

    expect(player.start).toHaveBeenCalled();
  });

  it('calls seekTo on timeline click', async () => {
    const user = userEvent.setup();
    const player = createMockPlayer({ isPlaying: true, duration: 200, currentTime: 50 });
    render(<MusicControls player={player} />);

    fireEvent.mouseEnter(document.querySelector('.music-toggle')!);

    const timeline = document.querySelector('.music-timeline')!;
    // Simulate click in the middle
    fireEvent.click(timeline, {
      clientX: 100,
    });

    // seekTo should be called with a fraction
    expect(player.seekTo).toHaveBeenCalled();
  });

  it('adds scrolling class for long song names', () => {
    const player = createMockPlayer({ currentSong: 'This Is A Very Long Song Name That Exceeds Twenty Characters' });
    render(<MusicControls player={player} />);

    const songName = document.querySelector('.song-name');
    expect(songName?.classList.contains('scrolling')).toBe(true);
  });

  it('does not add scrolling class for short song names', () => {
    const player = createMockPlayer({ currentSong: 'Short' });
    render(<MusicControls player={player} />);

    const songName = document.querySelector('.song-name');
    expect(songName?.classList.contains('scrolling')).toBe(false);
  });

  it('shows progress bar based on current time and duration', () => {
    const player = createMockPlayer({ currentTime: 60, duration: 120 });
    render(<MusicControls player={player} />);

    const progress = document.querySelector('.timeline-progress') as HTMLElement;
    expect(progress).toBeInTheDocument();
    expect(progress.style.width).toBe('50%');
  });

  it('shows 0% progress when duration is 0', () => {
    const player = createMockPlayer({ currentTime: 0, duration: 0 });
    render(<MusicControls player={player} />);

    const progress = document.querySelector('.timeline-progress') as HTMLElement;
    expect(progress.style.width).toBe('0%');
  });

  it('shows toggle arrow ▶ when visible and ◀ when hidden', () => {
    const player = createMockPlayer();
    render(<MusicControls player={player} />);

    const toggle = document.querySelector('.music-toggle')!;
    // Initially hidden → ◀
    expect(toggle.textContent).toBe('◀');

    // Show
    fireEvent.mouseEnter(toggle);
    expect(toggle.textContent).toBe('▶');
  });

  it('does not seekTo when timeline is clicked but not playing', async () => {
    const player = createMockPlayer({ isPlaying: false, duration: 120 });
    render(<MusicControls player={player} />);

    fireEvent.mouseEnter(document.querySelector('.music-toggle')!);

    const timeline = document.querySelector('.music-timeline')!;
    fireEvent.click(timeline, { clientX: 50 });

    expect(player.seekTo).not.toHaveBeenCalled();
  });
});
