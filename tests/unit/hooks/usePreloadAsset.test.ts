import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePreloadAsset } from '@/hooks/usePreloadAsset';

type FetchCall = {
  url: string;
  resolve: (r: { ok: boolean; status: number; blob: () => Promise<Blob> }) => void;
  reject: (err: Error) => void;
};

let fetchCalls: FetchCall[] = [];

function mockFetchImpl(input: string | URL | Request): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString();
  let resolve!: FetchCall['resolve'];
  let reject!: FetchCall['reject'];
  const promise = new Promise<Response>((res, rej) => {
    resolve = res as unknown as FetchCall['resolve'];
    reject = rej;
  });
  fetchCalls.push({ url, resolve, reject });
  return promise;
}

function respondOk(call: FetchCall) {
  call.resolve({
    ok: true,
    status: 200,
    blob: () => Promise.resolve(new Blob()),
  });
}

function respondError(call: FetchCall, status = 404) {
  call.resolve({
    ok: false,
    status,
    blob: () => Promise.resolve(new Blob()),
  });
}

describe('usePreloadAsset', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = vi.fn(mockFetchImpl) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns idle status when no asset URLs are passed', () => {
    const { result } = renderHook(() => usePreloadAsset({}));
    expect(result.current.imageStatus).toBe('idle');
    expect(result.current.audioStatus).toBe('idle');
    expect(fetchCalls).toHaveLength(0);
  });

  it('transitions image status pending → ok on successful fetch', async () => {
    const { result } = renderHook(() =>
      usePreloadAsset({ image: '/images/foo.jpg' })
    );
    expect(result.current.imageStatus).toBe('pending');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('/images/foo.jpg');
    await act(async () => { respondOk(fetchCalls[0]); });
    await waitFor(() => expect(result.current.imageStatus).toBe('ok'));
  });

  it('transitions image status pending → failed on non-ok response', async () => {
    const { result } = renderHook(() =>
      usePreloadAsset({ image: '/images/missing.jpg' })
    );
    await act(async () => { respondError(fetchCalls[0], 404); });
    await waitFor(() => expect(result.current.imageStatus).toBe('failed'));
  });

  it('transitions image status pending → failed on network error', async () => {
    const { result } = renderHook(() =>
      usePreloadAsset({ image: '/images/missing.jpg' })
    );
    await act(async () => { fetchCalls[0].reject(new Error('network down')); });
    await waitFor(() => expect(result.current.imageStatus).toBe('failed'));
  });

  it('transitions audio status pending → ok on successful fetch', async () => {
    const { result } = renderHook(() =>
      usePreloadAsset({ audio: '/audio/foo.m4a' })
    );
    expect(result.current.audioStatus).toBe('pending');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('/audio/foo.m4a');
    await act(async () => { respondOk(fetchCalls[0]); });
    await waitFor(() => expect(result.current.audioStatus).toBe('ok'));
  });

  it('transitions audio status pending → failed on error', async () => {
    const { result } = renderHook(() =>
      usePreloadAsset({ audio: '/audio/missing.m4a' })
    );
    await act(async () => { respondError(fetchCalls[0], 404); });
    await waitFor(() => expect(result.current.audioStatus).toBe('failed'));
  });

  it('does NOT allocate a MediaElement (no leaked HTTP connection)', () => {
    // The whole point of switching from `new Audio()` to `fetch()`: no
    // long-lived MediaElement keep-alives accumulating across question
    // advances. We verify the hook never touches `globalThis.Audio`.
    const audioCtor = vi.fn();
    const originalAudio = (globalThis as unknown as { Audio: unknown }).Audio;
    (globalThis as unknown as { Audio: unknown }).Audio = audioCtor;
    try {
      renderHook(() => usePreloadAsset({ audio: '/audio/foo.m4a' }));
      expect(audioCtor).not.toHaveBeenCalled();
    } finally {
      (globalThis as unknown as { Audio: unknown }).Audio = originalAudio;
    }
  });

  it('does NOT abort the in-flight fetch on cleanup (no AbortSignal)', async () => {
    const { unmount } = renderHook(() =>
      usePreloadAsset({ audio: '/audio/foo.m4a' })
    );
    // The fetch was called without an AbortSignal — Firefox coalesces preload
    // + main-game fetch for the same URL, and an abort here would also abort
    // the main game's request. Letting the fetch run to completion is safe.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const callArgs = fetchMock.mock.calls[0];
    const init = callArgs[1] as RequestInit | undefined;
    expect(init?.signal).toBeUndefined();
    unmount();
    // Resolve after unmount — must not throw, must not update state.
    await act(async () => { respondOk(fetchCalls[0]); });
  });

  it('re-fetches when retry() is called', async () => {
    const { result } = renderHook(() =>
      usePreloadAsset({ image: '/images/foo.jpg' })
    );
    expect(fetchCalls).toHaveLength(1);
    await act(async () => { respondError(fetchCalls[0], 500); });
    await waitFor(() => expect(result.current.imageStatus).toBe('failed'));
    act(() => { result.current.retry(); });
    expect(fetchCalls).toHaveLength(2);
    expect(result.current.imageStatus).toBe('pending');
    await act(async () => { respondOk(fetchCalls[1]); });
    await waitFor(() => expect(result.current.imageStatus).toBe('ok'));
  });

  it('ignores late response after unmount (no state update)', async () => {
    const { result, unmount } = renderHook(() =>
      usePreloadAsset({ image: '/images/foo.jpg' })
    );
    expect(result.current.imageStatus).toBe('pending');
    unmount();
    // Resolve after unmount — the result.current snapshot is from the last
    // render before unmount, so it should still be 'pending'.
    await act(async () => { respondOk(fetchCalls[0]); });
    expect(result.current.imageStatus).toBe('pending');
  });
});
