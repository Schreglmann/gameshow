import { describe, it, expect } from 'vitest';
import type { UploadProgress, YtDownloadProgress, AudioCoverProgress } from '@/components/backend/UploadContext';
import {
  buildProgressItems,
  overallPercent,
  overallPhase,
  overallDetail,
  uploadPercent,
  ytKey,
  coverKey,
  UPLOAD_KEY,
} from '@/utils/progressItems';

function upload(over: Partial<UploadProgress> = {}): UploadProgress {
  return {
    fileIndex: 0, total: 1, fileName: 'song.mp3', filePercent: 40,
    phase: 'uploading', category: 'audio',
    speed: 0, eta: 0, loaded: 0, fileSize: 0, elapsed: 0,
    ...over,
  };
}

function yt(over: Partial<YtDownloadProgress> = {}): YtDownloadProgress {
  return { id: 1, phase: 'downloading', percent: 50, title: 'Interstellar', ...over };
}

function cover(over: Partial<AudioCoverProgress> = {}): AudioCoverProgress {
  return { id: 1, phase: 'searching', fileIndex: 0, fileCount: 2, fileName: 'a.mp3', files: [], ...over };
}

describe('buildProgressItems', () => {
  it('returns an empty list when nothing is running', () => {
    expect(buildProgressItems(null, [], [])).toEqual([]);
  });

  it('keeps a fixed order: upload → YouTube → covers', () => {
    const items = buildProgressItems(upload(), [yt({ id: 7 }), yt({ id: 8, title: 'Dune' })], [cover({ id: 3 })]);
    expect(items.map(i => i.kind)).toEqual(['upload', 'yt', 'yt', 'cover']);
    expect(items.map(i => i.key)).toEqual([UPLOAD_KEY, 'yt:7', 'yt:8', 'cover:3']);
  });

  it('prefers the stable server id in a key so it survives a reload', () => {
    expect(ytKey({ id: 4, serverId: 'yt-abc' })).toBe('yt:yt-abc');
    expect(ytKey({ id: 4 })).toBe('yt:4');
    expect(coverKey({ id: 2, serverId: 'ac-9' })).toBe('cover:ac-9');
  });

  it('labels each kind the way the collapsed bar always has', () => {
    const items = buildProgressItems(
      upload({ fileName: 'clip.mp4' }),
      [yt({ id: 1 }), yt({ id: 2, playlistTitle: 'Best of 80s', trackCount: 12 })],
      [cover()],
    );
    expect(items.map(i => i.label)).toEqual([
      'Upload: clip.mp4',
      'YouTube: Interstellar',
      'YouTube Playlist: Best of 80s',
      'Audio Covers',
    ]);
  });

  it('falls back to a placeholder while a title is still resolving', () => {
    const [item] = buildProgressItems(null, [yt({ phase: 'resolving', title: '' })], []);
    expect(item!.label).toBe('YouTube: Wird geladen…');
    expect(item!.detail).toBe('');
    expect(item!.percent).toBe(0);
    expect(item!.phase).toBe('resolving');
  });

  it('shows a percentage for a single download and a count for a playlist', () => {
    const [single] = buildProgressItems(null, [yt({ percent: 42.4 })], []);
    expect(single!.detail).toBe('42 %');

    const [list] = buildProgressItems(null, [yt({
      playlistTitle: 'Mix', trackCount: 4,
      tracks: [
        { title: 'a', phase: 'done', percent: 100 },
        { title: 'b', phase: 'done', percent: 100 },
        { title: 'c', phase: 'downloading', percent: 30 },
      ],
    })], []);
    expect(list!.detail).toBe('2 / 4');
    expect(list!.percent).toBe(50);
  });

  it('marks a finished or failed job as no longer cancellable', () => {
    const [done] = buildProgressItems(null, [yt({ phase: 'done' })], []);
    expect(done!.detail).toBe('✓');
    expect(done!.percent).toBe(100);
    expect(done!.canCancel).toBe(false);

    const [failed] = buildProgressItems(null, [yt({ phase: 'error', error: 'kaputt' })], []);
    expect(failed!.detail).toBe('✕');
    expect(failed!.phase).toBe('error');
    expect(failed!.canCancel).toBe(false);
  });

  it('counts errored cover files as processed so the bar still completes', () => {
    const [item] = buildProgressItems(null, [], [cover({
      fileCount: 4,
      files: [
        { name: 'a', phase: 'done' },
        { name: 'b', phase: 'error' },
        { name: 'c', phase: 'searching' },
      ],
    })]);
    expect(item!.detail).toBe('1 / 4');
    expect(item!.percent).toBe(50);
  });
});

describe('uploadPercent', () => {
  it('weights the current file against the whole batch', () => {
    expect(uploadPercent(upload({ fileIndex: 1, total: 4, filePercent: 50 }))).toBe(37.5);
  });

  it('does not divide by zero on an empty batch', () => {
    expect(uploadPercent(upload({ total: 0 }))).toBe(0);
  });
});

describe('overall summary', () => {
  it('averages every row', () => {
    const items = buildProgressItems(null, [yt({ id: 1, percent: 20 }), yt({ id: 2, percent: 80 })], []);
    expect(overallPercent(items)).toBe(50);
    expect(overallDetail(items)).toBe('2 aktiv · 50 %');
  });

  it('is 0 with no rows', () => {
    expect(overallPercent([])).toBe(0);
    expect(overallPhase([])).toBe('active');
  });

  it('reports done once every row finished', () => {
    const items = buildProgressItems(null, [yt({ id: 1, phase: 'done' }), yt({ id: 2, phase: 'done' })], []);
    expect(overallPhase(items)).toBe('done');
    expect(overallDetail(items)).toBe('✓ 2 fertig');
  });

  it('lets a failure win over finished rows', () => {
    const items = buildProgressItems(null, [yt({ id: 1, phase: 'done' }), yt({ id: 2, phase: 'error' })], []);
    expect(overallPhase(items)).toBe('error');
    expect(overallDetail(items)).toBe('✕ 1 fehlgeschlagen');
  });

  it('keeps counting while one row is still running', () => {
    const items = buildProgressItems(null, [yt({ id: 1, phase: 'done' }), yt({ id: 2, percent: 0 })], []);
    expect(overallPhase(items)).toBe('active');
    expect(overallDetail(items)).toBe('1 aktiv · 50 %');
  });
});
