import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { UploadProvider, useUpload } from '@/components/backend/UploadContext';

// Mock all backendApi functions used by UploadContext
vi.mock('@/services/backendApi', () => ({
  uploadAsset: vi.fn(),
  youtubeDownload: vi.fn(),
  cancelYtDownload: vi.fn(),
  fetchYtDownloadStatus: vi.fn().mockResolvedValue([]),
  audioCoverFetch: vi.fn(),
  cancelAudioCoverFetch: vi.fn().mockResolvedValue(undefined),
  fetchAudioCoverStatus: vi.fn().mockResolvedValue([]),
  confirmAudioCover: vi.fn().mockResolvedValue(undefined),
  dismissAudioCoverJob: vi.fn().mockResolvedValue(undefined),
}));

// Import the mocked module to control it
import { audioCoverFetch, fetchAudioCoverStatus, cancelAudioCoverFetch as apiCancelAudioCover } from '@/services/backendApi';
const mockAudioCoverFetch = vi.mocked(audioCoverFetch);
const mockFetchAudioCoverStatus = vi.mocked(fetchAudioCoverStatus);
const mockApiCancelAudioCover = vi.mocked(apiCancelAudioCover);

function TestHarness({ onContext }: { onContext: (ctx: ReturnType<typeof useUpload>) => void }) {
  const ctx = useUpload();
  onContext(ctx);
  return (
    <div>
      {ctx.audioCoverDownloads.map(dl => (
        <div key={dl.id} data-testid={`dl-${dl.id}`}>
          <span data-testid="phase">{dl.phase}</span>
          <span data-testid="error">{dl.error ?? ''}</span>
          <button data-testid="dismiss" onClick={() => ctx.dismissAudioCoverFetch(dl.id)}>dismiss</button>
          <button data-testid="cancel" onClick={() => ctx.cancelAudioCoverFetch(dl.id)}>cancel</button>
        </div>
      ))}
      {ctx.pendingCoverConfirm && (
        <div data-testid="confirm-dialog">
          <span data-testid="confirm-artist">{ctx.pendingCoverConfirm.foundArtist}</span>
          <button data-testid="confirm-accept" onClick={() => ctx.respondCoverConfirm(true)}>accept</button>
          <button data-testid="confirm-reject" onClick={() => ctx.respondCoverConfirm(false)}>reject</button>
        </div>
      )}
    </div>
  );
}

describe('Audio cover dismiss/cancel', () => {
  let ctxRef: ReturnType<typeof useUpload>;
  let sseCallback: ((event: Record<string, unknown>) => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();

    // Capture the SSE callback and resolve when done
    mockAudioCoverFetch.mockImplementation((_files, onEvent) => {
      sseCallback = onEvent as (event: Record<string, unknown>) => void;
      // Return a promise that never resolves (simulates open SSE stream)
      return new Promise(() => {});
    });

    mockFetchAudioCoverStatus.mockResolvedValue([]);
    mockApiCancelAudioCover.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sseCallback = undefined;
  });

  function renderHarness() {
    return render(
      <UploadProvider>
        <TestHarness onContext={ctx => { ctxRef = ctx; }} />
      </UploadProvider>
    );
  }

  it('dismiss removes entry and poll does not re-add it', async () => {
    renderHarness();

    // Start a cover fetch
    await act(async () => {
      ctxRef.startAudioCoverFetch(['bad-guy.m4a']);
    });

    // Simulate SSE jobId event
    await act(async () => {
      sseCallback?.({ jobId: 'ac-123' });
    });

    // Simulate SSE fileDone event
    await act(async () => {
      sseCallback?.({ phase: 'searching', fileIndex: 1, fileCount: 1, fileName: 'bad-guy.m4a', fileDone: true, filePhase: 'error' });
    });

    // The entry should exist
    expect(screen.getByTestId('phase').textContent).toBe('searching');

    // Now dismiss it
    await act(async () => {
      screen.getByTestId('dismiss').click();
    });

    // Entry should be gone
    expect(screen.queryByTestId('phase')).toBeNull();

    // Simulate poll returning the job (server still has it for 60s)
    mockFetchAudioCoverStatus.mockResolvedValue([{
      id: 'ac-123',
      phase: 'done',
      fileIndex: 1,
      fileCount: 1,
      fileName: 'bad-guy.m4a',
      files: [{ name: 'bad-guy.m4a', phase: 'error' }],
      startedAt: Date.now(),
    }]);

    // Trigger poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    // Entry should NOT reappear
    expect(screen.queryByTestId('phase')).toBeNull();
  });

  it('cancel immediately shows error state and is not overwritten', async () => {
    renderHarness();

    // Start a cover fetch
    await act(async () => {
      ctxRef.startAudioCoverFetch(['bad-guy.m4a']);
    });

    // Simulate SSE jobId event
    await act(async () => {
      sseCallback?.({ jobId: 'ac-456' });
    });

    // Entry should be searching
    expect(screen.getByTestId('phase').textContent).toBe('searching');

    // Cancel it
    await act(async () => {
      screen.getByTestId('cancel').click();
    });

    // Should show error immediately
    expect(screen.getByTestId('phase').textContent).toBe('error');
    expect(screen.getByTestId('error').textContent).toBe('Abgebrochen');
  });

  it('confirm dialog does not reappear after reject', async () => {
    // Use a resolvable promise for the SSE stream
    let resolveSse!: () => void;
    mockAudioCoverFetch.mockImplementation((_files, onEvent) => {
      sseCallback = onEvent as (event: Record<string, unknown>) => void;
      return new Promise<void>((resolve) => { resolveSse = resolve; });
    });

    renderHarness();

    // Start a cover fetch
    await act(async () => {
      ctxRef.startAudioCoverFetch(['bad-guy.m4a']);
    });

    // SSE jobId
    await act(async () => {
      sseCallback?.({ jobId: 'ac-789' });
    });

    // SSE confirm event
    await act(async () => {
      sseCallback?.({
        phase: 'confirm',
        fileIndex: 1,
        fileCount: 1,
        fileName: 'bad-guy.m4a',
        foundArtist: 'Billie Eilish',
        foundTrack: 'bad guy',
        coverPreview: 'https://example.com/cover.jpg',
        source: 'itunes',
      });
    });

    // Confirm dialog should appear
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(screen.getByTestId('confirm-artist').textContent).toBe('Billie Eilish');

    // Reject it
    await act(async () => {
      screen.getByTestId('confirm-reject').click();
    });

    // Dialog should be gone
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();

    // Simulate the same confirm event arriving again (SSE buffering race)
    await act(async () => {
      sseCallback?.({
        phase: 'confirm',
        fileIndex: 1,
        fileCount: 1,
        fileName: 'bad-guy.m4a',
        foundArtist: 'Billie Eilish',
        foundTrack: 'bad guy',
        coverPreview: 'https://example.com/cover.jpg',
        source: 'itunes',
      });
    });

    // Dialog should NOT reappear
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('dismiss after SSE completes with confirm reject is not undone by poll', async () => {
    // Full flow: confirm → reject → done → dismiss → poll should not re-add
    let resolveSse!: () => void;
    mockAudioCoverFetch.mockImplementation((_files, onEvent) => {
      sseCallback = onEvent as (event: Record<string, unknown>) => void;
      return new Promise<void>((resolve) => { resolveSse = resolve; });
    });

    renderHarness();

    await act(async () => { ctxRef.startAudioCoverFetch(['bad-guy.m4a']); });
    await act(async () => { sseCallback?.({ jobId: 'ac-conf' }); });

    // Confirm event
    await act(async () => {
      sseCallback?.({
        phase: 'confirm', fileIndex: 1, fileCount: 1, fileName: 'bad-guy.m4a',
        foundArtist: 'Billie Eilish', foundTrack: 'bad guy',
        coverPreview: 'https://example.com/cover.jpg', source: 'itunes',
      });
    });
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();

    // Reject
    await act(async () => { screen.getByTestId('confirm-reject').click(); });
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();

    // Server sends fileDone (error, no cover) + done, SSE resolves
    await act(async () => {
      sseCallback?.({ phase: 'searching', fileIndex: 1, fileCount: 1, fileName: 'bad-guy.m4a', fileDone: true, filePhase: 'error' });
      sseCallback?.({ phase: 'done', fileCount: 1 });
      resolveSse();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    expect(screen.getByTestId('phase').textContent).toBe('done');

    // Dismiss
    await act(async () => { screen.getByTestId('dismiss').click(); });
    expect(screen.queryByTestId('phase')).toBeNull();

    // Poll returns the job
    mockFetchAudioCoverStatus.mockResolvedValue([{
      id: 'ac-conf', phase: 'done', fileIndex: 1, fileCount: 1, fileName: 'bad-guy.m4a',
      files: [{ name: 'bad-guy.m4a', phase: 'error' }], startedAt: Date.now(),
    }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });

    // Should NOT reappear
    expect(screen.queryByTestId('phase')).toBeNull();

    // After 5s timeout from .then() — still gone
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByTestId('phase')).toBeNull();
  });

  it('dismiss after SSE completes is not undone by .then() or poll', async () => {
    // SSE resolves immediately after all events are sent
    let resolveSse!: () => void;
    mockAudioCoverFetch.mockImplementation((_files, onEvent) => {
      sseCallback = onEvent as (event: Record<string, unknown>) => void;
      return new Promise<void>((resolve) => { resolveSse = resolve; });
    });

    renderHarness();

    // Start fetch
    await act(async () => {
      ctxRef.startAudioCoverFetch(['bad-guy.m4a']);
    });

    // SSE jobId
    await act(async () => {
      sseCallback?.({ jobId: 'ac-full' });
    });

    // SSE searching + fileDone
    await act(async () => {
      sseCallback?.({ phase: 'searching', fileIndex: 1, fileCount: 1, fileName: 'bad-guy.m4a', fileDone: true, filePhase: 'error' });
    });

    // SSE done + resolve the promise (triggers .then())
    await act(async () => {
      sseCallback?.({ phase: 'done', fileCount: 1 });
      resolveSse();
    });

    // Wait for .then() to process
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Entry should now be 'done'
    expect(screen.getByTestId('phase').textContent).toBe('done');

    // User clicks dismiss
    await act(async () => {
      screen.getByTestId('dismiss').click();
    });

    // Entry should be gone
    expect(screen.queryByTestId('phase')).toBeNull();

    // Poll returns the job (server still has it)
    mockFetchAudioCoverStatus.mockResolvedValue([{
      id: 'ac-full',
      phase: 'done',
      fileIndex: 1,
      fileCount: 1,
      fileName: 'bad-guy.m4a',
      files: [{ name: 'bad-guy.m4a', phase: 'error' }],
      startedAt: Date.now(),
    }]);

    // Advance past poll interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    // Entry should still NOT be there
    expect(screen.queryByTestId('phase')).toBeNull();

    // Advance past the 5s auto-dismiss timeout from .then()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Still gone
    expect(screen.queryByTestId('phase')).toBeNull();
  });
});
