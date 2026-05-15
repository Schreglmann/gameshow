import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePreloadAsset } from '@/hooks/usePreloadAsset';

let audioInstances: MockAudioEl[] = [];
let imageInstances: MockImg[] = [];

class MockAudioEl {
  src = '';
  preload = '';
  listeners: Record<string, ((e?: Event) => void)[]> = {};
  addEventListener(event: string, cb: (e?: Event) => void) {
    (this.listeners[event] ||= []).push(cb);
  }
  removeEventListener(event: string, cb: (e?: Event) => void) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(l => l !== cb);
    }
  }
  load = vi.fn();
  fire(event: string) {
    (this.listeners[event] || []).slice().forEach(cb => cb());
  }
}

class MockImg {
  _src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  get src() { return this._src; }
  set src(v: string) { this._src = v; }
}

describe('usePreloadAsset', () => {
  const originalAudio = (globalThis as any).Audio;
  const originalImage = (globalThis as any).Image;

  beforeEach(() => {
    audioInstances = [];
    imageInstances = [];
    (globalThis as any).Audio = class extends MockAudioEl {
      constructor() {
        super();
        audioInstances.push(this);
      }
    };
    (globalThis as any).Image = class extends MockImg {
      constructor() {
        super();
        imageInstances.push(this);
      }
    };
  });

  afterEach(() => {
    (globalThis as any).Audio = originalAudio;
    (globalThis as any).Image = originalImage;
  });

  it('returns idle status when no asset URLs are passed', () => {
    const { result } = renderHook(() => usePreloadAsset({}));
    expect(result.current.imageStatus).toBe('idle');
    expect(result.current.audioStatus).toBe('idle');
  });

  it('transitions image status pending → ok on load', () => {
    const { result } = renderHook(() =>
      usePreloadAsset({ image: '/images/foo.jpg' })
    );
    expect(result.current.imageStatus).toBe('pending');
    expect(imageInstances).toHaveLength(1);
    expect(imageInstances[0]._src).toBe('/images/foo.jpg');
    act(() => { imageInstances[0].onload?.(); });
    expect(result.current.imageStatus).toBe('ok');
  });

  it('transitions image status pending → failed on error', () => {
    const { result } = renderHook(() =>
      usePreloadAsset({ image: '/images/missing.jpg' })
    );
    expect(result.current.imageStatus).toBe('pending');
    act(() => { imageInstances[0].onerror?.(); });
    expect(result.current.imageStatus).toBe('failed');
  });

  it('transitions audio status pending → ok on canplaythrough', () => {
    const { result } = renderHook(() =>
      usePreloadAsset({ audio: '/audio/foo.m4a' })
    );
    expect(result.current.audioStatus).toBe('pending');
    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].src).toBe('/audio/foo.m4a');
    expect(audioInstances[0].preload).toBe('auto');
    expect(audioInstances[0].load).toHaveBeenCalled();
    act(() => { audioInstances[0].fire('canplaythrough'); });
    expect(result.current.audioStatus).toBe('ok');
  });

  it('transitions audio status pending → failed on error event', () => {
    const { result } = renderHook(() =>
      usePreloadAsset({ audio: '/audio/missing.m4a' })
    );
    act(() => { audioInstances[0].fire('error'); });
    expect(result.current.audioStatus).toBe('failed');
  });

  it('does NOT clear audio src on cleanup (Firefox coalesces preload + main fetch)', () => {
    const { unmount } = renderHook(() =>
      usePreloadAsset({ audio: '/audio/foo.m4a' })
    );
    const audio = audioInstances[0];
    audio.load.mockClear();
    unmount();
    // src is left intact; the in-flight request completes (or fails) on its own
    expect(audio.src).toBe('/audio/foo.m4a');
    expect(audio.load).not.toHaveBeenCalled();
  });

  it('does NOT clear image src on cleanup (Firefox coalesces preload + main fetch)', () => {
    const { unmount } = renderHook(() =>
      usePreloadAsset({ image: '/images/foo.jpg' })
    );
    const img = imageInstances[0];
    unmount();
    expect(img._src).toBe('/images/foo.jpg');
  });

  it('removes the canplaythrough/error listeners on cleanup', () => {
    const { unmount } = renderHook(() =>
      usePreloadAsset({ audio: '/audio/foo.m4a' })
    );
    const audio = audioInstances[0];
    expect(audio.listeners.canplaythrough.length).toBe(1);
    expect(audio.listeners.error.length).toBe(1);
    unmount();
    expect(audio.listeners.canplaythrough.length).toBe(0);
    expect(audio.listeners.error.length).toBe(0);
  });

  it('re-fetches when retry() is called', () => {
    const { result } = renderHook(() =>
      usePreloadAsset({ image: '/images/foo.jpg' })
    );
    expect(imageInstances).toHaveLength(1);
    act(() => { imageInstances[0].onerror?.(); });
    expect(result.current.imageStatus).toBe('failed');
    act(() => { result.current.retry(); });
    expect(imageInstances).toHaveLength(2);
    expect(result.current.imageStatus).toBe('pending');
    act(() => { imageInstances[1].onload?.(); });
    expect(result.current.imageStatus).toBe('ok');
  });

  it('ignores late onload after unmount (no warning, no state update)', () => {
    const { result, unmount } = renderHook(() =>
      usePreloadAsset({ image: '/images/foo.jpg' })
    );
    const img = imageInstances[0];
    unmount();
    // Should not throw — onload was nulled on cleanup
    expect(img.onload).toBeNull();
    expect(result.current.imageStatus).toBe('pending');
  });
});
