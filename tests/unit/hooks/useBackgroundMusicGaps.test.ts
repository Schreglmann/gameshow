import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Track created audio elements
const audioElements: any[] = [];

// We need to mock fetch for fetchBackgroundMusic
const mockFetch = vi.fn();

describe('useBackgroundMusic - Gaps', () => {
  let useBackgroundMusic: typeof import('@/hooks/useBackgroundMusic').useBackgroundMusic;

  beforeEach(async () => {
    vi.useFakeTimers();
    audioElements.length = 0;

    // Mock Audio constructor
    (globalThis as any).Audio = class MockAudioEl {
      src = '';
      volume = 1;
      currentTime = 0;
      duration = 120;
      paused = true;
      onended: (() => void) | null = null;
      ontimeupdate: (() => void) | null = null;
      play = vi.fn().mockImplementation(function(this: any) {
        this.paused = false;
        return Promise.resolve();
      });
      pause = vi.fn().mockImplementation(function(this: any) {
        this.paused = true;
      });
      load = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      constructor() {
        audioElements.push(this);
      }
    };

    // Mock fetch for background music
    globalThis.fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(['Track1.mp3', 'Track2.opus', 'Track3.wav']),
    });

    // Fresh import to avoid stale refs
    vi.resetModules();
    const mod = await import('@/hooks/useBackgroundMusic');
    useBackgroundMusic = mod.useBackgroundMusic;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads playlist on mount', async () => {
    const { result } = renderHook(() => useBackgroundMusic());
    await vi.advanceTimersByTimeAsync(100);

    // Should have fetched background music
    expect(mockFetch).toHaveBeenCalledWith('/api/background-music');
  });

  it('creates two audio elements for crossfade', async () => {
    renderHook(() => useBackgroundMusic());
    await vi.advanceTimersByTimeAsync(100);

    expect(audioElements).toHaveLength(2);
  });

  it('starts playback and sets currentSong name without extension', async () => {
    const { result } = renderHook(() => useBackgroundMusic());
    await vi.advanceTimersByTimeAsync(100);

    act(() => { result.current.start(); });
    await vi.advanceTimersByTimeAsync(100);

    expect(result.current.isPlaying).toBe(true);
    // Song name should not include extension
    expect(result.current.currentSong).not.toMatch(/\.(mp3|opus|wav)$/i);
    expect(result.current.currentSong.length).toBeGreaterThan(0);
  });

  it('pauses playback', async () => {
    const { result } = renderHook(() => useBackgroundMusic());
    await vi.advanceTimersByTimeAsync(100);

    act(() => { result.current.start(); });
    await vi.advanceTimersByTimeAsync(100);

    act(() => { result.current.pause(); });

    expect(result.current.isPlaying).toBe(false);
  });

  it('resumes playback after pause', async () => {
    const { result } = renderHook(() => useBackgroundMusic());
    await vi.advanceTimersByTimeAsync(100);

    act(() => { result.current.start(); });
    await vi.advanceTimersByTimeAsync(100);
    act(() => { result.current.pause(); });
    act(() => { result.current.resume(); });

    expect(result.current.isPlaying).toBe(true);
  });

  it('updates volume with setVolume', async () => {
    const { result } = renderHook(() => useBackgroundMusic());
    await vi.advanceTimersByTimeAsync(100);

    act(() => { result.current.setVolume(0.8); });

    expect(result.current.volume).toBe(0.8);
  });

  it('seekTo updates audio currentTime', async () => {
    const { result } = renderHook(() => useBackgroundMusic());
    await vi.advanceTimersByTimeAsync(100);

    act(() => { result.current.start(); });
    await vi.advanceTimersByTimeAsync(100);

    act(() => { result.current.seekTo(0.5); });

    // Active audio should have currentTime set
    const activeAudio = audioElements.find(a => !a.paused) || audioElements[0];
    expect(activeAudio.currentTime).toBe(0.5 * activeAudio.duration);
  });

  it('fadeOut decreases volume and pauses', async () => {
    const { result } = renderHook(() => useBackgroundMusic());
    await vi.advanceTimersByTimeAsync(100);

    act(() => { result.current.start(); });
    await vi.advanceTimersByTimeAsync(100);

    act(() => { result.current.fadeOut(2000); });
    // Advance through the entire fade
    await act(async () => { vi.advanceTimersByTime(2500); });

    expect(result.current.isPlaying).toBe(false);
  });

  it('fadeIn increases volume and starts playing', async () => {
    const { result } = renderHook(() => useBackgroundMusic());
    await vi.advanceTimersByTimeAsync(100);

    act(() => { result.current.start(); });
    await vi.advanceTimersByTimeAsync(100);
    act(() => { result.current.pause(); });

    act(() => { result.current.fadeIn(4000); });
    await act(async () => { vi.advanceTimersByTime(4500); });

    expect(result.current.isPlaying).toBe(true);
  });

  it('fadeIn calls start when no src is set', async () => {
    const { result } = renderHook(() => useBackgroundMusic());
    await vi.advanceTimersByTimeAsync(100);

    // Don't start - src remains empty
    // fadeIn should detect no src and call start() instead
    act(() => { result.current.fadeIn(4000); });
    await vi.advanceTimersByTimeAsync(500);

    expect(result.current.isPlaying).toBe(true);
  });

  it('skipToNext triggers crossfade to next track', async () => {
    const { result } = renderHook(() => useBackgroundMusic());
    await vi.advanceTimersByTimeAsync(100);

    act(() => { result.current.start(); });
    await vi.advanceTimersByTimeAsync(100);

    const firstSong = result.current.currentSong;

    act(() => { result.current.skipToNext(); });
    await act(async () => { vi.advanceTimersByTime(2500); });

    // Song should have changed
    expect(result.current.currentSong).not.toBe(firstSong);
  });

  it('handles empty playlist gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    vi.resetModules();
    const mod = await import('@/hooks/useBackgroundMusic');
    const { result } = renderHook(() => mod.useBackgroundMusic());
    await vi.advanceTimersByTimeAsync(100);

    // start() should not crash
    act(() => { result.current.start(); });
    expect(result.current.isPlaying).toBe(false);
  });

  it('default volume is 0.2', async () => {
    const { result } = renderHook(() => useBackgroundMusic());
    expect(result.current.volume).toBe(0.2);
  });

  it('returns all control functions', async () => {
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
});
