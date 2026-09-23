import type { UploadProgress, YtDownloadProgress, AudioCoverProgress } from '@/components/backend/UploadContext';

/** Drives the progress-fill colour class. Shared by the grouped rows and the collapsed bar. */
export type ProgressPhase = 'active' | 'done' | 'error' | 'resolving' | 'processing';

export type ProgressKind = 'upload' | 'yt' | 'yt-playlist' | 'cover';

export interface ProgressItemInfo {
  /** Stable key: survives a reload once the WebSocket reconnects the server-side job. */
  key: string;
  kind: ProgressKind;
  /** Row label, e.g. "YouTube: Interstellar — Main Theme". */
  label: string;
  /** Right-aligned status, e.g. "42 %", "3 / 12", "✓", "✕". */
  detail: string;
  /** 0–100, for this row's own track. */
  percent: number;
  phase: ProgressPhase;
  /** Client-side job id, for the cancel / dismiss callbacks. */
  id: number;
  /** False once the job reached `done` or `error` — the ✕ then dismisses instead. */
  canCancel: boolean;
}

/**
 * Stable server-assigned ids survive a reload; fall back to the local numeric id for
 * brand-new jobs that haven't been linked to a serverId yet.
 */
export const ytKey = (dl: Pick<YtDownloadProgress, 'id' | 'serverId'>) => `yt:${dl.serverId ?? dl.id}`;
export const coverKey = (dl: Pick<AudioCoverProgress, 'id' | 'serverId'>) => `cover:${dl.serverId ?? dl.id}`;
export const UPLOAD_KEY = 'upload';

/** Total progress of a multi-file upload, weighted across all files. */
export function uploadPercent(p: UploadProgress): number {
  if (p.total <= 0) return 0;
  return (p.fileIndex * 100 + p.filePercent) / p.total;
}

function ytPercent(dl: YtDownloadProgress): number {
  if (dl.playlistTitle) {
    const done = (dl.tracks ?? []).filter(t => t.phase === 'done').length;
    return dl.trackCount && dl.trackCount > 0 ? (done / dl.trackCount) * 100 : 0;
  }
  if (dl.phase === 'downloading') return dl.percent;
  return dl.phase === 'done' || dl.phase === 'error' || dl.phase === 'processing' ? 100 : 0;
}

function ytPhase(dl: YtDownloadProgress): ProgressPhase {
  if (dl.phase === 'done') return 'done';
  if (dl.phase === 'error') return 'error';
  if (dl.phase === 'processing') return 'processing';
  if (dl.phase === 'resolving') return 'resolving';
  return 'active';
}

/**
 * Flattens every in-flight job into one ordered row list. The order is fixed
 * (upload → YouTube → covers) and independent of each row's expanded state, so
 * expanding a row never makes the rows below it jump.
 */
export function buildProgressItems(
  uploadProgress: UploadProgress | null,
  ytDownloads: YtDownloadProgress[],
  audioCoverDownloads: AudioCoverProgress[],
): ProgressItemInfo[] {
  const items: ProgressItemInfo[] = [];

  if (uploadProgress) {
    items.push({
      key: UPLOAD_KEY,
      kind: 'upload',
      label: `Upload: ${uploadProgress.fileName}`,
      detail: uploadProgress.total > 1
        ? `${uploadProgress.fileIndex + 1} / ${uploadProgress.total}`
        : `${Math.round(uploadProgress.filePercent)} %`,
      percent: uploadPercent(uploadProgress),
      phase: uploadProgress.phase === 'processing' ? 'processing' : 'active',
      id: -1, // the upload job is cancelled via abortUpload(), not by id
      canCancel: true,
    });
  }

  for (const dl of ytDownloads) {
    const isPlaylist = !!dl.playlistTitle;
    const doneCount = (dl.tracks ?? []).filter(t => t.phase === 'done').length;
    const finished = dl.phase === 'done' || dl.phase === 'error';
    items.push({
      key: ytKey(dl),
      kind: isPlaylist ? 'yt-playlist' : 'yt',
      label: isPlaylist
        ? `YouTube Playlist: ${dl.playlistTitle}`
        : `YouTube: ${dl.title || 'Wird geladen…'}`,
      detail: dl.phase === 'done' ? '✓'
        : dl.phase === 'error' ? '✕'
        : isPlaylist ? `${doneCount} / ${dl.trackCount ?? '?'}`
        : dl.phase === 'downloading' ? `${Math.round(dl.percent)} %`
        : '',
      percent: ytPercent(dl),
      phase: ytPhase(dl),
      id: dl.id,
      canCancel: !finished,
    });
  }

  for (const dl of audioCoverDownloads) {
    const doneCount = dl.files.filter(f => f.phase === 'done').length;
    const errorCount = dl.files.filter(f => f.phase === 'error').length;
    const finished = dl.phase === 'done' || dl.phase === 'error';
    items.push({
      key: coverKey(dl),
      kind: 'cover',
      label: 'Audio Covers',
      detail: dl.phase === 'done' ? '✓'
        : dl.phase === 'error' ? '✕'
        : `${doneCount} / ${dl.fileCount}`,
      percent: dl.fileCount > 0 ? ((doneCount + errorCount) / dl.fileCount) * 100 : 0,
      phase: dl.phase === 'done' ? 'done' : dl.phase === 'error' ? 'error' : 'active',
      id: dl.id,
      canCancel: !finished,
    });
  }

  return items;
}

/** Mean progress across all rows — drives the group header's summary bar. */
export function overallPercent(items: ProgressItemInfo[]): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((acc, it) => acc + Math.max(0, Math.min(100, it.percent)), 0);
  return sum / items.length;
}

/** Phase shown on the group header / collapsed bar: errors win, then "all done". */
export function overallPhase(items: ProgressItemInfo[]): ProgressPhase {
  if (items.some(it => it.phase === 'error')) return 'error';
  if (items.length > 0 && items.every(it => it.phase === 'done')) return 'done';
  return 'active';
}

/** Group header summary, e.g. "3 aktiv · 38 %" or "✓ 4 fertig". */
export function overallDetail(items: ProgressItemInfo[]): string {
  const running = items.filter(it => it.phase !== 'done' && it.phase !== 'error');
  if (running.length === 0) {
    const errors = items.filter(it => it.phase === 'error').length;
    if (errors > 0) return `✕ ${errors} fehlgeschlagen`;
    return `✓ ${items.length} fertig`;
  }
  return `${running.length} aktiv · ${Math.round(overallPercent(items))} %`;
}
