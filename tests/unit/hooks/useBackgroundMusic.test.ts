import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBackgroundMusic } from '@/hooks/useBackgroundMusic';

// Track mock audio instances
let audioInstances: MockAudioEl[] = [];

class MockAudioEl {
  src = '';
  volume = 0;
  paused = true;
  currentTime = 0;
  duration = 120;
  onended: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;

  play = vi.fn().mockImplementation(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn().mockImplementation(() => {
    this.paused = true;
  });
  load = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

vi.mock('@/services/api', () => ({
  fetchBackgroundMusic: vi.fn().mockResolvedValue([
    'Track1.mp3',
    'Track2.mp3',
    'Track3.mp3',
  ]),
}));

describe('useBackgroundMusic', () => {
  beforeEach(() => {
    audioInstances = [];
    (globalThis as any).Audio = class extends MockAudioEl {
      constructor() {
        super();
        audioInstances.push(this);
      }
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns initial state with default values', () => {
    const { result } = renderHook(() => useBackgroundMusic());

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentSong).toBe('');
    expect(result.current.currentTime).toBe(0);
    expect(result.current.duration).toBe(0);
    expect(result.current.volume).toBe(0.2);
  });

  it('exposes all control functions', () => {
    const { result } = renderHook(() => useBackgroundMusic());

    expect(typeof result.current.start).toBe('function');
    expect(typeof result.current.pause).toBe('function');
    expect(typeof result.current.resume).toBe('function');
    expect(typeof result.current.skipToNext).toBe('function');
    expect(typeof result.current.setVolume).toBe('function');
    expect(typeof result.current.fadeOut).toBe('function');
    expect(typeof result.current.fadeIn).toBe('function');
    expect(typeof result.current.seekTo).toBe('function');
  });

  it('creates two audio elements on mount', () => {
    renderHook(() => useBackgroundMusic());
    expect(audioInstances).toHaveLength(2);
  });

  it('starts playback when start() is called', async () => {
    const { result } = renderHook(() => useBackgroundMusic());

    // Wait for playlist to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.start();
    });

    expect(result.current.isPlaying).toBe(true);
    // One of the audio elements should have play called
    const played = audioInstances.filter(a => a.play.mock.calls.length > 0);
    expect(played.length).toBeGreaterThan(0);
  });

  it('sets currentSong name without file extension', async () => {
    const { result } = renderHook(() => useBackgroundMusic());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.start();
    });

    // currentSong should be one of the tracks without extension
    expect(['Track1', 'Track2', 'Track3']).toContain(result.current.currentSong);
  });

  it('pauses playback when pause() is called', async () => {
    const { result } = renderHook(() => useBackgroundMusic());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.start();
    });
    expect(result.current.isPlaying).toBe(true);

    act(() => {
      result.current.pause();
    });
    expect(result.current.isPlaying).toBe(false);
  });

  it('resumes playback when resume() is called', async () => {
    const { result } = renderHook(() => useBackgroundMusic());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.pause();
    });
    expect(result.current.isPlaying).toBe(false);

    act(() => {
      result.current.resume();
    });
    expect(result.current.isPlaying).toBe(true);
  });

  it('updates volume with setVolume()', async () => {
    const { result } = renderHook(() => useBackgroundMusic());

    act(() => {
      result.current.setVolume(0.8);
    });

    expect(result.current.volume).toBe(0.8);
  });

  it('seeks to position with seekTo()', async () => {
    const { result } = renderHook(() => useBackgroundMusic());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.start();
    });

    // Find the active audio element (one that has play called with a src)
    const active = audioInstances.find(a => a.src !== '');
    if (active) {
      act(() => {
        result.current.seekTo(0.5);
      });
      expect(active.currentTime).toBe(60); // 0.5 * 120 duration
    }
  });

  it('fadeOut decreases volume over time', async () => {
    const { result } = renderHook(() => useBackgroundMusic());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.start();
    });

    const active = audioInstances.find(a => a.src !== '' && !a.paused);
    expect(active).toBeTruthy();

    act(() => {
      result.current.fadeOut(2000);
    });

    // After half the fade duration, volume should be less than starting
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(active!.volume).toBeLessThan(0.2);

    // After full fade, audio should be paused
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(active!.volume).toBe(0);
    expect(result.current.isPlaying).toBe(false);
  });

  it('fadeIn increases volume over time', async () => {
    const { result } = renderHook(() => useBackgroundMusic());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.start();
    });

    // Pause first
    act(() => {
      result.current.pause();
    });

    act(() => {
      result.current.fadeIn(2000);
    });

    expect(result.current.isPlaying).toBe(true);

    // Volume should increase over time
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const active = audioInstances.find(a => !a.paused);
    if (active) {
      expect(active.volume).toBeCloseTo(0.2, 1); // Should reach target volume
    }
  });
});
