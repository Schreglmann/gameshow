import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { YtDownloadProgress, AudioCoverProgress, UploadProgress } from '@/components/backend/UploadContext';

const h = vi.hoisted(() => ({
  ctx: {} as {
    uploadProgress: UploadProgress | null;
    abortUpload: () => void;
    ytDownloads: YtDownloadProgress[];
    cancelYtDownload: (id: number) => void;
    dismissYtDownload: (id: number) => void;
    audioCoverDownloads: AudioCoverProgress[];
    cancelAudioCoverFetch: (id: number) => void;
    dismissAudioCoverFetch: (id: number) => void;
    pendingCoverConfirm: null;
    respondCoverConfirm: (accept: boolean) => void;
  },
}));

vi.mock('@/components/backend/UploadContext', () => ({ useUpload: () => h.ctx }));
vi.mock('@/services/backendApi', () => ({ isUploadThrottled: () => false }));

import ProgressOverlay from '@/components/backend/ProgressOverlay';

const cancelYt = vi.fn();
const dismissYt = vi.fn();
const abortUpload = vi.fn();

function setJobs(yt: YtDownloadProgress[], upload: UploadProgress | null = null) {
  h.ctx = {
    uploadProgress: upload,
    abortUpload,
    ytDownloads: yt,
    cancelYtDownload: cancelYt,
    dismissYtDownload: dismissYt,
    audioCoverDownloads: [],
    cancelAudioCoverFetch: vi.fn(),
    dismissAudioCoverFetch: vi.fn(),
    pendingCoverConfirm: null,
    respondCoverConfirm: vi.fn(),
  };
}

function yt(over: Partial<YtDownloadProgress> = {}): YtDownloadProgress {
  return { id: 1, phase: 'downloading', percent: 50, title: 'Interstellar', category: 'audio', ...over };
}

const DOWNLOAD_PHASE = 'Audio wird von YouTube heruntergeladen…';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  setJobs([]);
});

describe('ProgressOverlay', () => {
  it('renders nothing when no job is running', () => {
    const { container } = render(<ProgressOverlay />);
    expect(container.querySelector('.progress-group')).toBeNull();
  });

  it('opens a lone download expanded and without a group header', () => {
    setJobs([yt()]);
    render(<ProgressOverlay />);

    expect(screen.getByText('YouTube: Interstellar')).toBeInTheDocument();
    expect(screen.getByText(DOWNLOAD_PHASE)).toBeInTheDocument();
    expect(screen.queryByText(/^Aktivität ·/)).toBeNull();
  });

  it('groups concurrent downloads into one panel and leaves the open row open', () => {
    setJobs([yt()]);
    const { rerender } = render(<ProgressOverlay />);
    expect(screen.getByText(DOWNLOAD_PHASE)).toBeInTheDocument();

    setJobs([yt(), yt({ id: 2, title: 'Dune', percent: 10 })]);
    rerender(<ProgressOverlay />);

    // One panel, one row per job, header summarising both.
    expect(document.querySelectorAll('.progress-group').length).toBe(1);
    expect(document.querySelectorAll('.progress-row').length).toBe(2);
    expect(screen.getByText('Aktivität · 2')).toBeInTheDocument();
    // The first row keeps its detail; the job that started alongside it stays compact.
    expect(screen.getAllByText(DOWNLOAD_PHASE).length).toBe(1);
    expect(screen.getByText('YouTube: Dune')).toBeInTheDocument();
  });

  it('toggles a row detail on click', () => {
    setJobs([yt(), yt({ id: 2, title: 'Dune' })]);
    render(<ProgressOverlay />);
    expect(screen.queryByText(DOWNLOAD_PHASE)).toBeNull();

    fireEvent.click(screen.getByText('YouTube: Dune'));
    expect(screen.getAllByText(DOWNLOAD_PHASE).length).toBe(1);

    fireEvent.click(screen.getByText('YouTube: Dune'));
    expect(screen.queryByText(DOWNLOAD_PHASE)).toBeNull();
  });

  it('cancels the job whose row was clicked, not the newest one', () => {
    setJobs([yt({ id: 11 }), yt({ id: 22, title: 'Dune' })]);
    render(<ProgressOverlay />);

    const rows = document.querySelectorAll('.progress-row');
    fireEvent.click(rows[0]!.querySelector('.progress-row-cancel')!);
    expect(cancelYt).toHaveBeenCalledWith(11);
  });

  it('dismisses instead of cancelling once a job finished', () => {
    setJobs([yt({ id: 11, phase: 'done' })]);
    render(<ProgressOverlay />);

    fireEvent.click(document.querySelector('.progress-row-cancel')!);
    expect(dismissYt).toHaveBeenCalledWith(11);
    expect(cancelYt).not.toHaveBeenCalled();
  });

  it('routes the upload row to abortUpload', () => {
    setJobs([], {
      fileIndex: 0, total: 1, fileName: 'song.mp3', filePercent: 40,
      phase: 'uploading', category: 'audio', speed: 0, eta: 0, loaded: 0, fileSize: 0, elapsed: 0,
    });
    render(<ProgressOverlay />);

    expect(screen.getByText('Upload: song.mp3')).toBeInTheDocument();
    fireEvent.click(document.querySelector('.progress-row-cancel')!);
    expect(abortUpload).toHaveBeenCalled();
  });

  it('collapses the whole group into one bar and back', () => {
    setJobs([yt(), yt({ id: 2, title: 'Dune' })]);
    render(<ProgressOverlay />);

    fireEvent.click(screen.getByRole('button', { name: 'Minimieren' }));
    expect(document.querySelector('.progress-group')).toBeNull();
    expect(screen.getByText('Aktivität')).toBeInTheDocument();
    expect(screen.getByText('2 aktiv · 50 %')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Erweitern' }));
    expect(document.querySelectorAll('.progress-row').length).toBe(2);
  });

  it('offers the minimize button on a lone row too', () => {
    setJobs([yt()]);
    render(<ProgressOverlay />);

    fireEvent.click(screen.getByRole('button', { name: 'Minimieren' }));
    expect(screen.getByText('Aktivität')).toBeInTheDocument();
  });

  it('opens a failed row so the error is never hidden behind a click', () => {
    setJobs([yt({ id: 1 }), yt({ id: 2, title: 'Dune' })]);
    const { rerender } = render(<ProgressOverlay />);
    expect(screen.queryByText('Video ist privat')).toBeNull();

    setJobs([yt({ id: 1 }), yt({ id: 2, title: 'Dune', phase: 'error', error: 'Video ist privat' })]);
    rerender(<ProgressOverlay />);
    expect(screen.getByText('Video ist privat')).toBeInTheDocument();
  });

  it('persists which rows are open across a remount', () => {
    setJobs([yt({ id: 1, serverId: 'yt-a' }), yt({ id: 2, serverId: 'yt-b', title: 'Dune' })]);
    const { unmount } = render(<ProgressOverlay />);
    fireEvent.click(screen.getByText('YouTube: Dune'));
    expect(JSON.parse(localStorage.getItem('admin-expanded-progress-rows')!)).toContain('yt:yt-b');
    unmount();

    render(<ProgressOverlay />);
    expect(screen.getAllByText(DOWNLOAD_PHASE).length).toBe(1);
  });

  it('drops the superseded minimize-state key on mount', () => {
    localStorage.setItem('admin-minimized-progress-keys', '["yt:1"]');
    setJobs([yt()]);
    render(<ProgressOverlay />);
    expect(localStorage.getItem('admin-minimized-progress-keys')).toBeNull();
  });

  it('caps the stack so it can never outgrow the viewport', () => {
    setJobs(Array.from({ length: 8 }, (_, i) => yt({ id: i + 1, title: `Track ${i + 1}` })));
    render(<ProgressOverlay />);

    expect(document.querySelectorAll('.progress-row').length).toBe(8);
    // One panel, one scroll container — not eight stacked boxes.
    expect(document.querySelectorAll('.upload-progress-box').length).toBe(1);
    expect(document.querySelector('.progress-group-rows')).not.toBeNull();
    expect(document.querySelector('.progress-stack')).not.toBeNull();
  });
});
