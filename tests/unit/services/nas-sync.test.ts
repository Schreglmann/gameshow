import { describe, it, expect } from 'vitest';
import {
  computeSyncOps,
  buildNewSyncState,
  resolvePrevFiles,
  parseSyncState,
  type FileMeta,
  type SyncState,
} from '../../../server/nas-sync';

// Helper to create FileMeta with a given date and size
function meta(dateStr: string, size: number): FileMeta {
  return { mtime: new Date(dateStr), size };
}

describe('computeSyncOps', () => {
  it('returns empty ops when both sides are identical', () => {
    const local = new Map([['audio/song.mp3', meta('2025-01-01', 1000)]]);
    const nas = new Map([['audio/song.mp3', meta('2025-01-01', 1000)]]);
    const ops = computeSyncOps(local, nas, {});
    expect(ops).toEqual([]);
  });

  it('returns empty ops when both sides are empty', () => {
    const ops = computeSyncOps(new Map(), new Map(), {});
    expect(ops).toEqual([]);
  });

  // ── Files on both sides with different sizes ──

  it('pushes to NAS when local is newer', () => {
    const local = new Map([['audio/song.mp3', meta('2025-06-01', 2000)]]);
    const nas = new Map([['audio/song.mp3', meta('2025-01-01', 1000)]]);
    const ops = computeSyncOps(local, nas, {});
    expect(ops).toEqual([{ action: 'push', rel: 'audio/song.mp3' }]);
  });

  it('pulls from NAS when NAS is newer', () => {
    const local = new Map([['audio/song.mp3', meta('2025-01-01', 1000)]]);
    const nas = new Map([['audio/song.mp3', meta('2025-06-01', 2000)]]);
    const ops = computeSyncOps(local, nas, {});
    expect(ops).toEqual([{ action: 'pull', rel: 'audio/song.mp3' }]);
  });

  it('skips files with same size even if mtime differs', () => {
    const local = new Map([['audio/song.mp3', meta('2025-01-01', 1000)]]);
    const nas = new Map([['audio/song.mp3', meta('2025-06-01', 1000)]]);
    const ops = computeSyncOps(local, nas, {});
    expect(ops).toEqual([]);
  });

  // ── File only on local ──

  it('pushes new local file to NAS when not in previous state', () => {
    const local = new Map([['images/new.jpg', meta('2025-06-01', 500)]]);
    const ops = computeSyncOps(local, new Map(), {});
    expect(ops).toEqual([{ action: 'push', rel: 'images/new.jpg' }]);
  });

  it('deletes local file when it was in previous state but missing from NAS (deleted by another machine)', () => {
    const local = new Map([['images/old.jpg', meta('2025-01-01', 500)]]);
    const prev = { 'images/old.jpg': '2025-01-01T00:00:00.000Z' };
    const ops = computeSyncOps(local, new Map(), prev);
    expect(ops).toEqual([{ action: 'delete-local', rel: 'images/old.jpg' }]);
  });

  // ── File only on NAS ──

  it('pulls new NAS file when not in previous state', () => {
    const nas = new Map([['videos/movie.mp4', meta('2025-06-01', 5000)]]);
    const ops = computeSyncOps(new Map(), nas, {});
    expect(ops).toEqual([{ action: 'pull', rel: 'videos/movie.mp4' }]);
  });

  it('deletes NAS file when it was in previous state but missing locally (deleted locally)', () => {
    const nas = new Map([['videos/old.mp4', meta('2025-01-01', 5000)]]);
    const prev = { 'videos/old.mp4': '2025-01-01T00:00:00.000Z' };
    const ops = computeSyncOps(new Map(), nas, prev);
    expect(ops).toEqual([{ action: 'delete-nas', rel: 'videos/old.mp4' }]);
  });

  // ── Multi-machine deletion propagation scenario ──

  it('propagates deletion across machines via NAS', () => {
    // Machine A deletes file.mp3. After A syncs, NAS no longer has it.
    // Machine B still has it locally, and it was in the previous sync state.
    // B should delete its local copy.
    const localB = new Map([['audio/file.mp3', meta('2025-01-01', 1000)]]);
    const nasAfterASync = new Map<string, FileMeta>(); // A deleted it from NAS
    const prevState = { 'audio/file.mp3': '2025-01-01T00:00:00.000Z' };

    const ops = computeSyncOps(localB, nasAfterASync, prevState);
    expect(ops).toEqual([{ action: 'delete-local', rel: 'audio/file.mp3' }]);
  });

  it('handles complex multi-file scenario', () => {
    // local has: unchanged.mp3 (same), modified.mp3 (newer local), new-local.mp3 (new)
    // NAS has: unchanged.mp3 (same), modified.mp3 (older), new-nas.mp3 (new)
    // prev state has: unchanged.mp3, modified.mp3, deleted-by-nas.mp3
    const local = new Map([
      ['audio/unchanged.mp3', meta('2025-01-01', 1000)],
      ['audio/modified.mp3', meta('2025-06-01', 2000)],
      ['audio/new-local.mp3', meta('2025-06-01', 500)],
      ['audio/deleted-by-nas.mp3', meta('2025-01-01', 300)],
    ]);
    const nas = new Map([
      ['audio/unchanged.mp3', meta('2025-01-01', 1000)],
      ['audio/modified.mp3', meta('2025-01-01', 1500)],
      ['audio/new-nas.mp3', meta('2025-06-01', 800)],
    ]);
    const prev = {
      'audio/unchanged.mp3': '2025-01-01T00:00:00.000Z',
      'audio/modified.mp3': '2025-01-01T00:00:00.000Z',
      'audio/deleted-by-nas.mp3': '2025-01-01T00:00:00.000Z',
    };

    const ops = computeSyncOps(local, nas, prev);

    // Sort for stable comparison
    const sorted = ops.sort((a, b) => a.rel.localeCompare(b.rel));
    expect(sorted).toEqual([
      { action: 'delete-local', rel: 'audio/deleted-by-nas.mp3' },
      { action: 'push', rel: 'audio/modified.mp3' },
      { action: 'push', rel: 'audio/new-local.mp3' },
      { action: 'pull', rel: 'audio/new-nas.mp3' },
    ]);
  });
});

describe('buildNewSyncState', () => {
  it('includes all files that are not being deleted', () => {
    const local = new Map([
      ['audio/keep.mp3', meta('2025-01-01', 1000)],
      ['audio/delete-me.mp3', meta('2025-01-01', 500)],
    ]);
    const nas = new Map([
      ['audio/from-nas.mp3', meta('2025-01-01', 800)],
    ]);
    const ops = [
      { action: 'delete-local' as const, rel: 'audio/delete-me.mp3' },
    ];

    const state = buildNewSyncState(local, nas, ops);

    expect(state.files['audio/keep.mp3']).toBeDefined();
    expect(state.files['audio/from-nas.mp3']).toBeDefined();
    expect(state.files['audio/delete-me.mp3']).toBeUndefined();
    expect(state.lastSync).toBeTruthy();
  });

  it('excludes files deleted from NAS', () => {
    const local = new Map<string, FileMeta>();
    const nas = new Map([['audio/gone.mp3', meta('2025-01-01', 500)]]);
    const ops = [{ action: 'delete-nas' as const, rel: 'audio/gone.mp3' }];

    const state = buildNewSyncState(local, nas, ops);
    expect(state.files['audio/gone.mp3']).toBeUndefined();
  });

  it('prefers local mtime when file exists on both sides', () => {
    const local = new Map([['audio/a.mp3', meta('2025-06-01', 1000)]]);
    const nas = new Map([['audio/a.mp3', meta('2025-01-01', 1000)]]);
    const state = buildNewSyncState(local, nas, []);
    expect(state.files['audio/a.mp3']).toBe(new Date('2025-06-01').toISOString());
  });
});

describe('resolvePrevFiles', () => {
  it('uses local state when local lastSync is more recent', () => {
    const local: SyncState = { lastSync: '2025-06-01T00:00:00Z', files: { a: '1' } };
    const nas: SyncState = { lastSync: '2025-01-01T00:00:00Z', files: { b: '2' } };
    expect(resolvePrevFiles(local, nas)).toEqual({ a: '1' });
  });

  it('uses NAS state when NAS lastSync is more recent', () => {
    const local: SyncState = { lastSync: '2025-01-01T00:00:00Z', files: { a: '1' } };
    const nas: SyncState = { lastSync: '2025-06-01T00:00:00Z', files: { b: '2' } };
    expect(resolvePrevFiles(local, nas)).toEqual({ b: '2' });
  });

  it('uses local state when timestamps are equal', () => {
    const local: SyncState = { lastSync: '2025-01-01T00:00:00Z', files: { a: '1' } };
    const nas: SyncState = { lastSync: '2025-01-01T00:00:00Z', files: { b: '2' } };
    expect(resolvePrevFiles(local, nas)).toEqual({ a: '1' });
  });

  it('returns empty when both states are fresh (no prior sync)', () => {
    const local: SyncState = { lastSync: '', files: {} };
    const nas: SyncState = { lastSync: '', files: {} };
    expect(resolvePrevFiles(local, nas)).toEqual({});
  });
});

describe('parseSyncState', () => {
  it('parses valid JSON', () => {
    const json = JSON.stringify({ lastSync: '2025-01-01T00:00:00Z', files: { 'a.mp3': '2025-01-01' } });
    const state = parseSyncState(json);
    expect(state.lastSync).toBe('2025-01-01T00:00:00Z');
    expect(state.files['a.mp3']).toBe('2025-01-01');
  });

  it('returns empty state for invalid JSON', () => {
    expect(parseSyncState('not json')).toEqual({ lastSync: '', files: {} });
  });

  it('returns empty state for empty string', () => {
    expect(parseSyncState('')).toEqual({ lastSync: '', files: {} });
  });

  it('returns empty state for JSON missing required fields', () => {
    expect(parseSyncState('{"foo": "bar"}')).toEqual({ lastSync: '', files: {} });
  });
});

describe('multi-machine sync scenarios', () => {
  it('first sync on new machine pulls all NAS files', () => {
    // New machine has no local files and no previous sync state
    const local = new Map<string, FileMeta>();
    const nas = new Map([
      ['audio/a.mp3', meta('2025-01-01', 1000)],
      ['images/b.jpg', meta('2025-01-01', 2000)],
    ]);
    const prev = {}; // no prior sync

    const ops = computeSyncOps(local, nas, prev);
    expect(ops).toEqual([
      { action: 'pull', rel: 'audio/a.mp3' },
      { action: 'pull', rel: 'images/b.jpg' },
    ]);
  });

  it('three-machine scenario: A creates, B deletes, C syncs', () => {
    // Step 1: Machine A creates file.mp3 and syncs → both local-A and NAS have it
    // Step 2: Machine B syncs → pulls file.mp3
    // Step 3: Machine B deletes file.mp3 locally and syncs → NAS copy deleted
    // Step 4: Machine C (which has file.mp3 from a previous sync) syncs
    //         prevFiles includes file.mp3, but NAS no longer has it → delete-local

    const localC = new Map([['audio/file.mp3', meta('2025-01-01', 1000)]]);
    const nasAfterBDelete = new Map<string, FileMeta>(); // B deleted it
    const prevAfterStep2 = { 'audio/file.mp3': '2025-01-01T00:00:00.000Z' };

    const ops = computeSyncOps(localC, nasAfterBDelete, prevAfterStep2);
    expect(ops).toEqual([{ action: 'delete-local', rel: 'audio/file.mp3' }]);
  });

  it('simultaneous edits: newer file wins', () => {
    // Machine A edits file.mp3 (newer, larger)
    // Machine B still has old version
    // NAS has A's version
    const localB = new Map([['audio/file.mp3', meta('2025-01-01', 1000)]]);
    const nasWithA = new Map([['audio/file.mp3', meta('2025-06-01', 2000)]]);
    const prev = { 'audio/file.mp3': '2025-01-01T00:00:00.000Z' };

    const ops = computeSyncOps(localB, nasWithA, prev);
    expect(ops).toEqual([{ action: 'pull', rel: 'audio/file.mp3' }]);
  });

  it('new file created locally while offline syncs to NAS on reconnect', () => {
    // Machine was offline, user uploaded a file.
    // On reconnect (startup sync), the file should push to NAS.
    const local = new Map([['audio/offline-upload.mp3', meta('2025-06-01', 1500)]]);
    const nas = new Map<string, FileMeta>();
    const prev = {}; // file didn't exist at last sync

    const ops = computeSyncOps(local, nas, prev);
    expect(ops).toEqual([{ action: 'push', rel: 'audio/offline-upload.mp3' }]);
  });
});
