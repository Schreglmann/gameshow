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
    // Icons are inline SVG (no emoji glyphs), so match on the accessible name.
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('shows pause button when playing', () => {
    const player = createMockPlayer({ isPlaying: true, currentSong: 'Test' });
    render(<MusicControls player={player} />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Next Track' })).toBeInTheDocument();
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

  describe('docked variant', () => {
    it('renders no collapse toggle and is always expanded', () => {
      const player = createMockPlayer({ currentSong: 'A' });
      render(<MusicControls player={player} docked />);
      const root = document.querySelector('.music-controls')!;
      expect(root.classList.contains('docked')).toBe(true);
      expect(root.classList.contains('visible')).toBe(true); // never collapses
      expect(document.querySelector('.music-toggle')).toBeNull();
    });

    it('still renders the full control set (play, volume, skip, timeline)', () => {
      const player = createMockPlayer({ isPlaying: true, currentSong: 'A', currentTime: 30, duration: 120, volume: 0.4 });
      render(<MusicControls player={player} docked />);
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next Track' })).toBeInTheDocument();
      expect(document.querySelector('input[type="range"]')).toBeInTheDocument();
      expect(document.querySelector('.music-timeline')).toBeInTheDocument();
      expect(screen.getByText('0:30 / 2:00')).toBeInTheDocument();
    });
  });
});
