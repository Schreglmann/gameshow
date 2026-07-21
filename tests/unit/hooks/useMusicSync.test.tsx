import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useMusicStateSync,
  useMusicState,
  useSendMusicCommand,
  useMusicCommandListener,
} from '@/hooks/useMusicSync';
import { setInactiveShowTab } from '@/services/showPresenceState';
import type { MusicPlayerControls } from '@/hooks/useBackgroundMusic';
import type { MusicPlayerState } from '@/types/game';

// Capture raw WS sends + the subscribed channel handlers so we can drive the
// hooks without a real socket. Mirrors useGamemasterSync.contentGuard.test.tsx.
const { sendWs } = vi.hoisted(() => ({ sendWs: vi.fn() }));
const captured: Record<string, (data: unknown) => void> = {};

vi.mock('@/services/useBackendSocket', () => ({
  sendWs: (channel: string, data: unknown) => sendWs(channel, data),
  onWsOpen: () => () => {},
  useWsChannel: (channel: string, handler: (data: unknown) => void) => {
    captured[channel] = handler;
  },
}));

function mockPlayer(overrides: Partial<MusicPlayerControls> = {}): MusicPlayerControls {
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

describe('useMusicSync', () => {
  beforeEach(() => {
    sendWs.mockClear();
    setInactiveShowTab(false);
    for (const key of Object.keys(captured)) delete captured[key];
    localStorage.clear();
  });

  describe('useMusicStateSync (show writer)', () => {
    it('broadcasts the initial music-state on mount', () => {
      const player = mockPlayer({ isPlaying: true, currentSong: 'Track A', currentTime: 5, duration: 100, volume: 0.3 });
      renderHook(() => useMusicStateSync(player));
      expect(sendWs).toHaveBeenCalledTimes(1);
      expect(sendWs).toHaveBeenCalledWith('music-state', {
        isPlaying: true,
        currentSong: 'Track A',
        currentTime: 5,
        duration: 100,
        volume: 0.3,
      });
    });

    it('re-emits when a control field (volume) changes', () => {
      const { rerender } = renderHook(({ p }) => useMusicStateSync(p), {
        initialProps: { p: mockPlayer({ isPlaying: true, currentSong: 'A', volume: 0.2 }) },
      });
      expect(sendWs).toHaveBeenCalledTimes(1);
      rerender({ p: mockPlayer({ isPlaying: true, currentSong: 'A', volume: 0.5 }) });
      expect(sendWs).toHaveBeenCalledTimes(2);
      expect(sendWs).toHaveBeenLastCalledWith('music-state', expect.objectContaining({ volume: 0.5 }));
    });

    it('does not emit when the tab is an inactive show', () => {
      setInactiveShowTab(true);
      renderHook(() => useMusicStateSync(mockPlayer({ isPlaying: true, currentSong: 'A' })));
      expect(sendWs).not.toHaveBeenCalled();
    });

    it('dedupes the 1 Hz tick: a paused track stops re-emitting, a moving one keeps going', () => {
      vi.useFakeTimers();
      try {
        const { rerender } = renderHook(({ p }) => useMusicStateSync(p), {
          initialProps: { p: mockPlayer({ isPlaying: true, currentSong: 'A', currentTime: 10, duration: 100 }) },
        });
        expect(sendWs).toHaveBeenCalledTimes(1); // initial

        // Same state → interval tick is deduped.
        act(() => { vi.advanceTimersByTime(1000); });
        expect(sendWs).toHaveBeenCalledTimes(1);

        // currentTime advanced (control fields unchanged, so only the tick emits).
        rerender({ p: mockPlayer({ isPlaying: true, currentSong: 'A', currentTime: 11, duration: 100 }) });
        expect(sendWs).toHaveBeenCalledTimes(1); // control effect did NOT fire
        act(() => { vi.advanceTimersByTime(1000); });
        expect(sendWs).toHaveBeenCalledTimes(2); // tick emitted the new currentTime
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('useSendMusicCommand (gamemaster sender)', () => {
    it('sends a music-command with action, value and a timestamp', () => {
      const { result } = renderHook(() => useSendMusicCommand());
      act(() => result.current('volume', 0.7));
      expect(sendWs).toHaveBeenCalledWith(
        'music-command',
        expect.objectContaining({ action: 'volume', value: 0.7, timestamp: expect.any(Number) }),
      );
    });
  });

  describe('useMusicCommandListener (show side)', () => {
    it('toggle → pause while playing, resume while stopped-with-track, start from cold', () => {
      const playing = mockPlayer({ isPlaying: true, currentSong: 'A' });
      renderHook(() => useMusicCommandListener(playing));
      act(() => captured['music-command']({ action: 'toggle', timestamp: 1 }));
      expect(playing.pause).toHaveBeenCalledTimes(1);

      const paused = mockPlayer({ isPlaying: false, currentSong: 'A' });
      renderHook(() => useMusicCommandListener(paused));
      act(() => captured['music-command']({ action: 'toggle', timestamp: 2 }));
      expect(paused.resume).toHaveBeenCalledTimes(1);

      const cold = mockPlayer({ isPlaying: false, currentSong: '' });
      renderHook(() => useMusicCommandListener(cold));
      act(() => captured['music-command']({ action: 'toggle', timestamp: 3 }));
      expect(cold.start).toHaveBeenCalledTimes(1);
    });

    it('maps skip / volume / seek to the player', () => {
      const player = mockPlayer({ isPlaying: true, currentSong: 'A' });
      renderHook(() => useMusicCommandListener(player));
      act(() => captured['music-command']({ action: 'skip', timestamp: 1 }));
      act(() => captured['music-command']({ action: 'volume', value: 0.4, timestamp: 2 }));
      act(() => captured['music-command']({ action: 'seek', value: 0.5, timestamp: 3 }));
      expect(player.skipToNext).toHaveBeenCalledTimes(1);
      expect(player.setVolume).toHaveBeenCalledWith(0.4);
      expect(player.seekTo).toHaveBeenCalledWith(0.5);
    });

    it('ignores commands with a stale-or-equal timestamp (replay guard)', () => {
      const player = mockPlayer({ isPlaying: true, currentSong: 'A' });
      renderHook(() => useMusicCommandListener(player));
      act(() => captured['music-command']({ action: 'skip', timestamp: 5 }));
      act(() => captured['music-command']({ action: 'skip', timestamp: 5 }));
      act(() => captured['music-command']({ action: 'skip', timestamp: 4 }));
      expect(player.skipToNext).toHaveBeenCalledTimes(1);
    });

    it('drops commands while the tab is an inactive show', () => {
      setInactiveShowTab(true);
      const player = mockPlayer({ isPlaying: true, currentSong: 'A' });
      renderHook(() => useMusicCommandListener(player));
      act(() => captured['music-command']({ action: 'skip', timestamp: 1 }));
      expect(player.skipToNext).not.toHaveBeenCalled();
    });
  });

  describe('useMusicState (gamemaster reader)', () => {
    it('seeds from localStorage then follows pushed state', () => {
      const seed: MusicPlayerState = { isPlaying: false, currentSong: 'Seed', currentTime: 0, duration: 0, volume: 0.2 };
      localStorage.setItem('gm:last-music', JSON.stringify(seed));
      const { result } = renderHook(() => useMusicState());
      expect(result.current).toEqual(seed);

      const pushed: MusicPlayerState = { isPlaying: true, currentSong: 'Live', currentTime: 12, duration: 200, volume: 0.5 };
      act(() => captured['music-state'](pushed));
      expect(result.current).toEqual(pushed);
    });
  });
});
