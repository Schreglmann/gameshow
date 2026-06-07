import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBackgroundMusic, reconcileBackgroundPlaylist } from '@/hooks/useBackgroundMusic';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';

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

// ── Pure reconciliation helper ──────────────────────────────────────────────
describe('reconcileBackgroundPlaylist', () => {
  it('appends added tracks and keeps the current track index', () => {
    const r = reconcileBackgroundPlaylist(['a', 'b', 'c'], 1, ['a', 'b', 'c', 'd']);
    expect(r.playlist).toEqual(['a', 'b', 'c', 'd']);
    expect(r.currentIndex).toBe(1);
    expect(r.currentDeleted).toBe(false);
  });

  it('drops a deleted non-current track; the current index follows it', () => {
    // delete 'b', current track is 'c'
    const r = reconcileBackgroundPlaylist(['a', 'b', 'c'], 2, ['a', 'c']);
    expect(r.playlist).toEqual(['a', 'c']);
    expect(r.currentIndex).toBe(1);
    expect(r.currentDeleted).toBe(false);
  });

  it('flags deletion of the current track and resumes from the next survivor', () => {
    // delete current 'b'; next survivor is 'c' → index 1 in the rebuilt list
    const r = reconcileBackgroundPlaylist(['a', 'b', 'c', 'd'], 1, ['a', 'c', 'd']);
    expect(r.currentDeleted).toBe(true);
    expect(r.playlist).toEqual(['a', 'c', 'd']);
    expect(r.resumeIndex).toBe(1);
  });

  it('resumes from the start when the deleted current track had no later survivor', () => {
    // delete current 'c' (last) → resume from index 0
    const r = reconcileBackgroundPlaylist(['a', 'b', 'c'], 2, ['a', 'b']);
    expect(r.currentDeleted).toBe(true);
    expect(r.resumeIndex).toBe(0);
  });

  it('reports an empty playlist when everything was deleted', () => {
    const r = reconcileBackgroundPlaylist(['a'], 0, []);
    expect(r.playlist).toEqual([]);
    expect(r.currentDeleted).toBe(true);
    expect(r.resumeIndex).toBe(-1);
  });
});

// ── Hook behaviour over the assets-changed channel ──────────────────────────
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

const base = (src: string): string => src.split('/').pop() ?? src;
const playing = (): MockAudioEl | undefined => audioInstances.find(a => !a.paused && a.src !== '');

const GLOBAL = ['Global1.mp3', 'Global2.mp3', 'Global3.mp3'];

describe('useBackgroundMusic - live DAM (assets-changed) reload', () => {
  beforeEach(() => {
    audioInstances = [];
    __clearWsCacheForTests();
    (globalThis as any).Audio = class extends MockAudioEl {
      constructor() {
        super();
        audioInstances.push(this);
      }
    };
    vi.useFakeTimers();
    // Deterministic shuffle: comparator returns 0 → playlist order preserved.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    mocks.theme.value = 'galaxia';
    mocks.fetchBackgroundMusic.mockResolvedValue([...GLOBAL]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  async function mountAndStart() {
    const hook = renderHook(() => useBackgroundMusic());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { hook.result.current.start(); });
    return hook;
  }

  async function emitMusicChange() {
    act(() => { __emitChannelForTests('assets-changed', { category: 'background-music' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  }

  it('ignores asset changes for other categories', async () => {
    const { result } = await mountAndStart();
    const active = playing()!;
    const srcBefore = active.src;
    const playsBefore = active.play.mock.calls.length;

    act(() => { __emitChannelForTests('assets-changed', { category: 'images' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(mocks.fetchBackgroundMusic).toHaveBeenCalledTimes(1); // only the mount load
    expect(active.src).toBe(srcBefore);
    expect(active.play.mock.calls.length).toBe(playsBefore);
    expect(result.current.isPlaying).toBe(true);
  });

  it('does NOT interrupt the running song when music is added', async () => {
    const { result } = await mountAndStart();
    const active = playing()!;
    const srcBefore = active.src;
    const playsBefore = active.play.mock.calls.length;
    expect(base(srcBefore)).toBe('Global1.mp3');

    mocks.fetchBackgroundMusic.mockResolvedValue([...GLOBAL, 'Global4.mp3']);
    await emitMusicChange();
    // Advance well past any fade window to prove no swap was scheduled.
    act(() => { vi.advanceTimersByTime(2500); });

    expect(active.src).toBe(srcBefore);
    expect(active.play.mock.calls.length).toBe(playsBefore);
    expect(active.paused).toBe(false);
    expect(active.volume).toBe(0.2);
    expect(result.current.isPlaying).toBe(true);
  });

  it('does NOT interrupt the running song when a different (non-playing) track is deleted', async () => {
    const { result } = await mountAndStart();
    const active = playing()!;
    const srcBefore = active.src; // Global1.mp3 is current
    const playsBefore = active.play.mock.calls.length;

    // Delete Global3 (not the current track).
    mocks.fetchBackgroundMusic.mockResolvedValue(['Global1.mp3', 'Global2.mp3']);
    await emitMusicChange();
    act(() => { vi.advanceTimersByTime(2500); });

    expect(active.src).toBe(srcBefore);
    expect(active.play.mock.calls.length).toBe(playsBefore);
    expect(active.paused).toBe(false);
    expect(result.current.isPlaying).toBe(true);
  });

  it('crossfades to a surviving track when the currently-playing track is deleted', async () => {
    const { result } = await mountAndStart();
    const before = playing()!;
    expect(base(before.src)).toBe('Global1.mp3');

    // Delete the current track (Global1); Global2/Global3 survive.
    mocks.fetchBackgroundMusic.mockResolvedValue(['Global2.mp3', 'Global3.mp3']);
    await emitMusicChange();
    // Run the 2s crossfade to completion.
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });

    const after = playing();
    expect(after).toBeTruthy();
    expect(base(after!.src)).toBe('Global2.mp3');
    // The deleted track is no longer the playing element.
    expect(audioInstances.some(a => !a.paused && base(a.src) === 'Global1.mp3')).toBe(false);
    expect(result.current.isPlaying).toBe(true);
  });

  it('stops playback cleanly when every track is deleted', async () => {
    const { result } = await mountAndStart();
    expect(result.current.isPlaying).toBe(true);

    mocks.fetchBackgroundMusic.mockResolvedValue([]);
    await emitMusicChange();

    expect(result.current.isPlaying).toBe(false);
    expect(playing()).toBeUndefined();
  });
});
