import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBackgroundMusic } from '@/hooks/useBackgroundMusic';

// Mutable theme + fetch mock, hoisted so the vi.mock factories can reference them.
const mocks = vi.hoisted(() => ({
  theme: { value: 'galaxia' as string },
  fetchBackgroundMusic: vi.fn<(theme?: string) => Promise<string[]>>(),
}));

vi.mock('@/services/api', () => ({
  fetchBackgroundMusic: mocks.fetchBackgroundMusic,
}));

vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({ theme: mocks.theme.value, activeTheme: mocks.theme.value }),
  useCurrentFrontendTheme: () => mocks.theme.value,
}));

let audioInstances: MockAudioEl[] = [];

class MockAudioEl {
  src = '';
  volume = 0;
  paused = true;
  currentTime = 0;
  duration = 120;
  onended: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;

  play = vi.fn().mockImplementation(function (this: MockAudioEl) {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn().mockImplementation(function (this: MockAudioEl) {
    this.paused = true;
  });
  load = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

// The global root playlist returned for any theme without a dedicated soundtrack.
const GLOBAL_PLAYLIST = ['Global1.mp3', 'Global2.mp3', 'Global3.mp3'];
const RETRO_PLAYLIST = ['retro/r1.mp3', 'retro/r2.mp3', 'retro/r3.mp3'];

describe('useBackgroundMusic - theme switch music continuity', () => {
  beforeEach(() => {
    audioInstances = [];
    (globalThis as any).Audio = class extends MockAudioEl {
      constructor() {
        super();
        audioInstances.push(this);
      }
    };
    vi.useFakeTimers();
    mocks.theme.value = 'galaxia';
    // Themes with a dedicated folder return their own files; everything else
    // falls back to the shared global playlist (mirrors the server behaviour).
    mocks.fetchBackgroundMusic.mockImplementation((theme?: string) => {
      if (theme === 'retro') return Promise.resolve([...RETRO_PLAYLIST]);
      return Promise.resolve([...GLOBAL_PLAYLIST]);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('keeps the same track playing when switching between two themes that both fall back to the global playlist', async () => {
    const { result, rerender } = renderHook(() => useBackgroundMusic());

    // Let the initial playlist load, then start playback.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      result.current.start();
    });
    expect(result.current.isPlaying).toBe(true);

    const active = audioInstances.find(a => a.src !== '' && !a.paused);
    expect(active).toBeTruthy();
    const srcBefore = active!.src;
    const playCallsBefore = active!.play.mock.calls.length;

    // Switch to another theme that ALSO has no dedicated music (global fallback).
    mocks.theme.value = 'modern-music';
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Advance well past any fade-out window to prove no swap was scheduled.
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Same track, still playing, no restart, full volume preserved.
    expect(active!.src).toBe(srcBefore);
    expect(active!.play.mock.calls.length).toBe(playCallsBefore);
    expect(active!.paused).toBe(false);
    expect(active!.volume).toBe(0.2);
    expect(result.current.isPlaying).toBe(true);
  });

  it('still swaps the playlist when switching to a theme with a dedicated soundtrack', async () => {
    const { result, rerender } = renderHook(() => useBackgroundMusic());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      result.current.start();
    });
    const active = audioInstances.find(a => a.src !== '' && !a.paused);
    expect(active!.src).toContain('Global');

    // Switch to a theme WITH its own music — the source set differs, so a swap occurs.
    mocks.theme.value = 'retro';
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Run the fade-out (600ms) so the source swap fires.
    act(() => {
      vi.advanceTimersByTime(700);
    });

    const playingRetro = audioInstances.find(a => a.src.includes('retro/') && !a.paused);
    expect(playingRetro).toBeTruthy();
  });
});
