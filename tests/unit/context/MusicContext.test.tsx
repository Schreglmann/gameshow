import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock the background music hook before importing MusicContext
vi.mock('@/hooks/useBackgroundMusic', () => ({
  useBackgroundMusic: vi.fn().mockReturnValue({
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
  }),
}));

import { MusicProvider, useMusicPlayer } from '@/context/MusicContext';
import { useBackgroundMusic } from '@/hooks/useBackgroundMusic';

describe('MusicContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when useMusicPlayer is used outside MusicProvider', () => {
    // Suppress console.error for the expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      renderHook(() => useMusicPlayer());
    }).toThrow('useMusicPlayer must be used inside MusicProvider');
    spy.mockRestore();
  });

  it('returns music controls when used inside MusicProvider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MusicProvider>{children}</MusicProvider>
    );
    const { result } = renderHook(() => useMusicPlayer(), { wrapper });

    expect(result.current).toBeDefined();
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.volume).toBe(0.2);
    expect(typeof result.current.start).toBe('function');
    expect(typeof result.current.pause).toBe('function');
    expect(typeof result.current.resume).toBe('function');
    expect(typeof result.current.skipToNext).toBe('function');
    expect(typeof result.current.setVolume).toBe('function');
    expect(typeof result.current.fadeOut).toBe('function');
    expect(typeof result.current.fadeIn).toBe('function');
    expect(typeof result.current.seekTo).toBe('function');
  });

  it('MusicProvider wraps useBackgroundMusic and provides its value', () => {
    const mockControls = {
      isPlaying: true,
      currentSong: 'Test Song',
      currentTime: 42,
      duration: 180,
      volume: 0.5,
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      skipToNext: vi.fn(),
      setVolume: vi.fn(),
      fadeOut: vi.fn(),
      fadeIn: vi.fn(),
      seekTo: vi.fn(),
    };
    vi.mocked(useBackgroundMusic).mockReturnValue(mockControls);

    function TestConsumer() {
      const music = useMusicPlayer();
      return (
        <div>
          <span data-testid="song">{music.currentSong}</span>
          <span data-testid="playing">{String(music.isPlaying)}</span>
          <span data-testid="time">{music.currentTime}</span>
        </div>
      );
    }

    render(
      <MusicProvider>
        <TestConsumer />
      </MusicProvider>
    );

    expect(screen.getByTestId('song').textContent).toBe('Test Song');
    expect(screen.getByTestId('playing').textContent).toBe('true');
    expect(screen.getByTestId('time').textContent).toBe('42');
  });
});
