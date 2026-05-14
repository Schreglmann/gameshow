import { describe, it, expect } from 'vitest';
import {
  computeSyncOps,
  buildNewSyncState,
  resolvePrevFiles,
  parseSyncState,
  applySnapshotOp,
  applyDeletionSafety,
  checkBulkDelete,
  trashRel,
  makeRunId,
  type FileMeta,
  type SyncState,
  type SyncOp,
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

  // ── failedOps handling (regression for the 2026-05-14 incident) ──
  // If buildNewSyncState records a file as in-sync after its push/pull failed,
  // the next sync sees "in prev + missing on the other side" and trashes the
  // file. omit-on-failure is the invariant that makes the recovery path safe.

  it('omits files whose push op failed, so next sync retries the push', () => {
    const local = new Map([['audio/new.mp3', meta('2025-06-01', 500)]]);
    const nas = new Map<string, FileMeta>();
    const ops = [{ action: 'push' as const, rel: 'audio/new.mp3' }];
    const failedOps = new Set(['audio/new.mp3']);

    const state = buildNewSyncState(local, nas, ops, failedOps);
    // File is not recorded — next sync sees "local has + not in prev" → push (retry)
    expect(state.files['audio/new.mp3']).toBeUndefined();
  });

  it('omits files whose pull op failed, so next sync retries the pull', () => {
    const local = new Map<string, FileMeta>();
    const nas = new Map([['audio/new.mp3', meta('2025-06-01', 500)]]);
    const ops = [{ action: 'pull' as const, rel: 'audio/new.mp3' }];
    const failedOps = new Set(['audio/new.mp3']);

    const state = buildNewSyncState(local, nas, ops, failedOps);
    expect(state.files['audio/new.mp3']).toBeUndefined();
  });

  it('includes files whose op succeeded even if other ops failed', () => {
    const local = new Map([
      ['audio/ok.mp3', meta('2025-06-01', 500)],
      ['audio/fail.mp3', meta('2025-06-01', 500)],
    ]);
    const nas = new Map<string, FileMeta>();
    const ops = [
      { action: 'push' as const, rel: 'audio/ok.mp3' },
      { action: 'push' as const, rel: 'audio/fail.mp3' },
    ];
    const failedOps = new Set(['audio/fail.mp3']);

    const state = buildNewSyncState(local, nas, ops, failedOps);
    expect(state.files['audio/ok.mp3']).toBeDefined();
    expect(state.files['audio/fail.mp3']).toBeUndefined();
  });

  it('defaults failedOps to empty set when omitted (backwards compatible)', () => {
    const local = new Map([['audio/a.mp3', meta('2025-01-01', 1000)]]);
    const nas = new Map<string, FileMeta>();
    const ops = [{ action: 'push' as const, rel: 'audio/a.mp3' }];

    const state = buildNewSyncState(local, nas, ops);
    // No failedOps passed → all non-deleted files are recorded
    expect(state.files['audio/a.mp3']).toBeDefined();
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

describe('applySnapshotOp (per-op sync-state mutations after successful NAS op)', () => {
  function freshState(files: Record<string, string>): SyncState {
    return { lastSync: '2025-01-01T00:00:00.000Z', files: { ...files } };
  }

  it('upsert records the mtime under the given rel', () => {
    const snap = freshState({});
    applySnapshotOp(snap, { type: 'upsert', rel: 'audio/new.mp3', mtime: new Date('2025-06-01') });
    expect(snap.files['audio/new.mp3']).toBe(new Date('2025-06-01').toISOString());
  });

  it('upsert overwrites an existing entry', () => {
    const snap = freshState({ 'audio/song.mp3': '2025-01-01T00:00:00.000Z' });
    applySnapshotOp(snap, { type: 'upsert', rel: 'audio/song.mp3', mtime: new Date('2025-06-01') });
    expect(snap.files['audio/song.mp3']).toBe(new Date('2025-06-01').toISOString());
  });

  it('delete of a file removes only that entry', () => {
    const snap = freshState({
      'audio/song.mp3': '2025-01-01T00:00:00.000Z',
      'audio/keep.mp3': '2025-01-01T00:00:00.000Z',
    });
    applySnapshotOp(snap, { type: 'delete', rel: 'audio/song.mp3' });
    expect(snap.files['audio/song.mp3']).toBeUndefined();
    expect(snap.files['audio/keep.mp3']).toBeDefined();
  });

  it('delete of a folder removes every entry under its prefix', () => {
    const snap = freshState({
      'audio/Folder/a.mp3': '2025-01-01T00:00:00.000Z',
      'audio/Folder/b.mp3': '2025-01-01T00:00:00.000Z',
      'audio/Folder/sub/c.mp3': '2025-01-01T00:00:00.000Z',
      'audio/OtherFolder/d.mp3': '2025-01-01T00:00:00.000Z',
      'audio/FolderSibling.mp3': '2025-01-01T00:00:00.000Z',
    });
    applySnapshotOp(snap, { type: 'delete', rel: 'audio/Folder' });
    expect(snap.files['audio/Folder/a.mp3']).toBeUndefined();
    expect(snap.files['audio/Folder/b.mp3']).toBeUndefined();
    expect(snap.files['audio/Folder/sub/c.mp3']).toBeUndefined();
    expect(snap.files['audio/OtherFolder/d.mp3']).toBeDefined();
    // Guard: "audio/FolderSibling.mp3" shares the "audio/Folder" substring but
    // is not a child of the deleted folder — must survive.
    expect(snap.files['audio/FolderSibling.mp3']).toBeDefined();
  });

  it('move of a single file rewrites the key', () => {
    const snap = freshState({ 'audio/old.mp3': '2025-01-01T00:00:00.000Z' });
    applySnapshotOp(snap, { type: 'move', relFrom: 'audio/old.mp3', relTo: 'audio/new.mp3' });
    expect(snap.files['audio/old.mp3']).toBeUndefined();
    expect(snap.files['audio/new.mp3']).toBe('2025-01-01T00:00:00.000Z');
  });

  it('move of a folder rewrites every child key and preserves sibling keys', () => {
    const snap = freshState({
      'audio/OldName/a.mp3': '2025-01-01T00:00:00.000Z',
      'audio/OldName/sub/b.mp3': '2025-02-01T00:00:00.000Z',
      'audio/Other/c.mp3': '2025-03-01T00:00:00.000Z',
      'audio/OldNameSibling.mp3': '2025-04-01T00:00:00.000Z',
    });
    applySnapshotOp(snap, { type: 'move', relFrom: 'audio/OldName', relTo: 'audio/NewName' });
    expect(snap.files['audio/OldName/a.mp3']).toBeUndefined();
    expect(snap.files['audio/OldName/sub/b.mp3']).toBeUndefined();
    expect(snap.files['audio/NewName/a.mp3']).toBe('2025-01-01T00:00:00.000Z');
    expect(snap.files['audio/NewName/sub/b.mp3']).toBe('2025-02-01T00:00:00.000Z');
    expect(snap.files['audio/Other/c.mp3']).toBe('2025-03-01T00:00:00.000Z');
    // Sibling that shares the "audio/OldName" substring but is not under the
    // folder — must survive unchanged.
    expect(snap.files['audio/OldNameSibling.mp3']).toBe('2025-04-01T00:00:00.000Z');
  });

  it('cross-category move (audio → background-music) rewrites the key', () => {
    const snap = freshState({ 'audio/theme.mp3': '2025-01-01T00:00:00.000Z' });
    applySnapshotOp(snap, {
      type: 'move',
      relFrom: 'audio/theme.mp3',
      relTo: 'background-music/theme.mp3',
    });
    expect(snap.files['audio/theme.mp3']).toBeUndefined();
    expect(snap.files['background-music/theme.mp3']).toBe('2025-01-01T00:00:00.000Z');
  });
});

describe('DAM action durability: failed NAS op leaves recoverable sync state', () => {
  // Regression tests for the reported bug: "I just renamed a folder in the DAM
  // and the following NAS sync names it back." Same root cause affects every
  // DAM action (upload, move, rename, delete) — a queued NAS op that fails or
  // is lost must not be treated as in-sync. The algorithm below exercises the
  // recovery path: if the snapshot was NOT updated (because the NAS op didn't
  // succeed), the next bidirectional sync reads the unchanged prev state and
  // computeSyncOps issues the right recovery ops.

  it('rename folder + NAS op fails → sync re-applies the move correctly', () => {
    // Before: both sides have audio/Old/file.mp3. User renames Old → New in
    // the DAM; local is now audio/New/file.mp3. NAS move op fails → NAS still
    // has audio/Old/file.mp3. Snapshot is NOT mutated (bug fix invariant).
    const prev = { 'audio/Old/file.mp3': '2025-01-01T00:00:00.000Z' };
    const local = new Map([['audio/New/file.mp3', meta('2025-01-01', 1000)]]);
    const nas = new Map([['audio/Old/file.mp3', meta('2025-01-01', 1000)]]);

    const ops = computeSyncOps(local, nas, prev);
    const sorted = ops.sort((a, b) => a.rel.localeCompare(b.rel));

    // Expected recovery: push the new path to NAS, delete the old path on NAS.
    // The folder is NOT renamed back to "Old" on local.
    expect(sorted).toEqual([
      { action: 'push', rel: 'audio/New/file.mp3' },
      { action: 'delete-nas', rel: 'audio/Old/file.mp3' },
    ]);
  });

  it('upload + NAS op fails → sync pushes the new file (does not delete local)', () => {
    // Before: both sides empty. User uploads audio/new.mp3 via the DAM; local
    // has it, NAS copy failed. Snapshot NOT mutated → file not in prev.
    const prev = {};
    const local = new Map([['audio/new.mp3', meta('2025-06-01', 500)]]);
    const nas = new Map<string, FileMeta>();

    const ops = computeSyncOps(local, nas, prev);
    expect(ops).toEqual([{ action: 'push', rel: 'audio/new.mp3' }]);
  });

  it('delete + NAS op fails → sync deletes on NAS (file does not reappear)', () => {
    // Before: both sides have audio/gone.mp3, recorded in prev. User deletes
    // it in the DAM; local unlink succeeded, NAS delete failed. Snapshot NOT
    // mutated → prev still has the entry.
    const prev = { 'audio/gone.mp3': '2025-01-01T00:00:00.000Z' };
    const local = new Map<string, FileMeta>();
    const nas = new Map([['audio/gone.mp3', meta('2025-01-01', 500)]]);

    const ops = computeSyncOps(local, nas, prev);
    expect(ops).toEqual([{ action: 'delete-nas', rel: 'audio/gone.mp3' }]);
  });

  it('move file + NAS op fails → sync pushes new path and deletes old (no revert)', () => {
    const prev = { 'audio/old.mp3': '2025-01-01T00:00:00.000Z' };
    const local = new Map([['audio/new.mp3', meta('2025-01-01', 800)]]);
    const nas = new Map([['audio/old.mp3', meta('2025-01-01', 800)]]);

    const ops = computeSyncOps(local, nas, prev);
    const sorted = ops.sort((a, b) => a.rel.localeCompare(b.rel));
    expect(sorted).toEqual([
      { action: 'push', rel: 'audio/new.mp3' },
      { action: 'delete-nas', rel: 'audio/old.mp3' },
    ]);
  });

  it('rename folder + NAS op succeeds → snapshot update leaves nothing to do next sync', () => {
    // Successful path: snapshot IS mutated by applySnapshotOp('move', ...).
    // Prev now has audio/New/file.mp3, local and NAS both have it too.
    const prev: Record<string, string> = { 'audio/Old/file.mp3': '2025-01-01T00:00:00.000Z' };
    const snap: SyncState = { lastSync: '2025-01-01T00:00:00.000Z', files: { ...prev } };
    applySnapshotOp(snap, { type: 'move', relFrom: 'audio/Old', relTo: 'audio/New' });

    const local = new Map([['audio/New/file.mp3', meta('2025-01-01', 1000)]]);
    const nas = new Map([['audio/New/file.mp3', meta('2025-01-01', 1000)]]);

    const ops = computeSyncOps(local, nas, snap.files);
    expect(ops).toEqual([]);
  });
});

// ── Safety layer tests ──────────────────────────────────────────────────────

describe('applyDeletionSafety (Layer 2 — per-folder loss-ratio veto)', () => {
  it('strips delete-local ops when NAS folder is fully empty (the original 2026-05-08 incident)', () => {
    // Reproduces the original incident: local had hundreds of images, NAS-side
    // scan returned zero (mount degraded), prev had entries for images/.
    // computeSyncOps emits delete-local for every image; the veto must strip them.
    const local = new Map<string, FileMeta>([
      ['images/Personen/Mercer.jpg', meta('2026-04-01', 1000)],
      ['images/Logos/ABBA.png', meta('2026-04-01', 1000)],
      ['audio/song.mp3', meta('2026-04-01', 1000)],
    ]);
    const nas = new Map<string, FileMeta>([
      // images/ folder appears empty on NAS — full loss (100% > 5%)
      ['audio/song.mp3', meta('2026-04-01', 1000)],
    ]);
    const prev = {
      'images/Personen/Mercer.jpg': '2026-04-01T00:00:00.000Z',
      'images/Logos/ABBA.png': '2026-04-01T00:00:00.000Z',
      'audio/song.mp3': '2026-04-01T00:00:00.000Z',
    };

    const ops = computeSyncOps(local, nas, prev);
    expect(ops.filter((o) => o.action === 'delete-local')).toHaveLength(2);

    const safe = applyDeletionSafety(ops, local, nas, prev);
    expect(safe.ops.filter((o) => o.action === 'delete-local')).toEqual([]);
    expect(safe.vetoes).toEqual([
      { folder: 'images', side: 'local', count: 2, lossRatio: 1 },
    ]);
  });

  it('strips delete-local ops on partial NAS loss (the 2026-05-14 incident)', () => {
    // Reproduces the partial-loss incident the old "entirely empty" check missed:
    // NAS lost ~14% of images/ (still had a few files), so the old veto did not
    // fire and 269 files were trashed. With loss-ratio ≥ 5%, this is now caught.
    // Simulated: 20 prev image entries, NAS has only 17 (15% loss).
    const local = new Map<string, FileMeta>();
    const nas = new Map<string, FileMeta>();
    const prev: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      const rel = `images/photo-${i}.jpg`;
      local.set(rel, meta('2026-04-01', 1000));
      prev[rel] = '2026-04-01T00:00:00.000Z';
      if (i < 17) nas.set(rel, meta('2026-04-01', 1000)); // NAS lost 3 of 20 = 15%
    }

    const ops = computeSyncOps(local, nas, prev);
    expect(ops.filter((o) => o.action === 'delete-local')).toHaveLength(3);

    const safe = applyDeletionSafety(ops, local, nas, prev);
    expect(safe.ops.filter((o) => o.action === 'delete-local')).toEqual([]);
    expect(safe.vetoes).toHaveLength(1);
    expect(safe.vetoes[0].folder).toBe('images');
    expect(safe.vetoes[0].side).toBe('local');
    expect(safe.vetoes[0].count).toBe(3);
    expect(safe.vetoes[0].lossRatio).toBeCloseTo(0.15, 2);
  });

  it('allows a single delete when the folder loss-ratio is below 5%', () => {
    // Folder had 100 files in prev, NAS lost 1 (1% loss) — well under threshold.
    // This is the legitimate single-file delete case (external delete via Finder,
    // or admin DAM delete with the NAS op succeeded but state-snap update lost).
    const local = new Map<string, FileMeta>();
    const nas = new Map<string, FileMeta>();
    const prev: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      const rel = `images/photo-${i}.jpg`;
      local.set(rel, meta('2026-04-01', 1000));
      prev[rel] = '2026-04-01T00:00:00.000Z';
      if (i > 0) nas.set(rel, meta('2026-04-01', 1000)); // NAS lost just 1 of 100 = 1%
    }

    const ops = computeSyncOps(local, nas, prev);
    const safe = applyDeletionSafety(ops, local, nas, prev);
    // 1% loss < 5% → no veto, the legitimate single delete proceeds.
    expect(safe.vetoes).toEqual([]);
    expect(safe.ops).toEqual([{ action: 'delete-local', rel: 'images/photo-0.jpg' }]);
  });

  it('strips delete-nas ops when local folder lost ≥ 5% of prev', () => {
    // Local-side data loss case (symmetric): local lost 4 of 20 audio files (20%).
    const local = new Map<string, FileMeta>();
    const nas = new Map<string, FileMeta>();
    const prev: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      const rel = `audio/song-${i}.mp3`;
      nas.set(rel, meta('2026-04-01', 1000));
      prev[rel] = '2026-04-01T00:00:00.000Z';
      if (i < 16) local.set(rel, meta('2026-04-01', 1000)); // local lost 4 of 20 = 20%
    }

    const ops = computeSyncOps(local, nas, prev);
    expect(ops.filter((o) => o.action === 'delete-nas')).toHaveLength(4);

    const safe = applyDeletionSafety(ops, local, nas, prev);
    expect(safe.ops.filter((o) => o.action === 'delete-nas')).toEqual([]);
    expect(safe.vetoes[0]).toMatchObject({ folder: 'audio', side: 'nas', count: 4 });
    expect(safe.vetoes[0].lossRatio).toBeCloseTo(0.2, 2);
  });

  it('does not veto a folder that was legitimately empty in prev state', () => {
    // images/ folder has no files in prev — so loss-ratio is undefined, not suspect.
    const local = new Map<string, FileMeta>([
      ['images/new.jpg', meta('2026-04-01', 1000)],
    ]);
    const nas = new Map<string, FileMeta>();
    const prev = {}; // prev has nothing for images/

    const ops = computeSyncOps(local, nas, prev);
    const safe = applyDeletionSafety(ops, local, nas, prev);
    // Without prev entries, the file is "new local" → push, not delete-local.
    expect(safe.vetoes).toEqual([]);
    expect(safe.ops).toEqual(ops);
  });

  it('vetoes one folder independently of others', () => {
    // images/ on NAS is fully empty (100% loss → veto delete-local for images).
    // audio/ has 100 files; 1 was deleted locally (1% loss) → audio delete-nas survives.
    const local = new Map<string, FileMeta>();
    const nas = new Map<string, FileMeta>();
    const prev: Record<string, string> = {};
    // images: prev has 10, local has 10, NAS has 0 → 100% loss on NAS side
    for (let i = 0; i < 10; i++) {
      const rel = `images/photo-${i}.jpg`;
      local.set(rel, meta('2026-04-01', 1000));
      prev[rel] = '2026-04-01T00:00:00.000Z';
    }
    // audio: prev has 100, NAS has 100, local has 99 → 1% loss on local side
    for (let i = 0; i < 100; i++) {
      const rel = `audio/song-${i}.mp3`;
      nas.set(rel, meta('2026-04-01', 1000));
      prev[rel] = '2026-04-01T00:00:00.000Z';
      if (i > 0) local.set(rel, meta('2026-04-01', 1000));
    }

    const ops = computeSyncOps(local, nas, prev);
    const safe = applyDeletionSafety(ops, local, nas, prev);

    // images delete-local was vetoed; audio delete-nas was preserved (1% under threshold).
    expect(safe.ops).toEqual([{ action: 'delete-nas', rel: 'audio/song-0.mp3' }]);
    expect(safe.vetoes).toMatchObject([{ folder: 'images', side: 'local', count: 10 }]);
  });

  it('preserves push and pull ops untouched (only delete ops are filtered)', () => {
    const local = new Map<string, FileMeta>([
      ['images/photo.jpg', meta('2026-06-01', 2000)],
    ]);
    const nas = new Map<string, FileMeta>([
      ['images/photo.jpg', meta('2026-04-01', 1000)],
      ['images/other.jpg', meta('2026-04-01', 500)],
    ]);
    // prev has images/ entries — but both sides actually have images, so no veto.
    const prev = { 'images/photo.jpg': '2026-04-01T00:00:00.000Z' };

    const ops = computeSyncOps(local, nas, prev);
    const safe = applyDeletionSafety(ops, local, nas, prev);
    expect(safe.vetoes).toEqual([]);
    expect(safe.ops).toEqual(ops);
  });

  it('returns empty vetoes array when no folder is suspect', () => {
    const local = new Map<string, FileMeta>([['audio/a.mp3', meta('2026-04-01', 1000)]]);
    const nas = new Map<string, FileMeta>([['audio/a.mp3', meta('2026-04-01', 1000)]]);
    const safe = applyDeletionSafety([], local, nas, {});
    expect(safe.ops).toEqual([]);
    expect(safe.vetoes).toEqual([]);
  });
});

describe('checkBulkDelete (Layer 3 — bulk-delete hard cap of 5)', () => {
  function makeFiles(count: number, prefix = 'audio'): Map<string, FileMeta> {
    const m = new Map<string, FileMeta>();
    for (let i = 0; i < count; i++) m.set(`${prefix}/file-${i}.mp3`, meta('2026-04-01', 1000));
    return m;
  }

  it('passes when there are no deletions', () => {
    const ops: SyncOp[] = [
      { action: 'push', rel: 'audio/a.mp3' },
      { action: 'pull', rel: 'audio/b.mp3' },
    ];
    const result = checkBulkDelete(ops, makeFiles(10), makeFiles(10));
    expect(result.ok).toBe(true);
    expect(result.totalDeletes).toBe(0);
    expect(result.threshold).toBe(5);
  });

  it('passes when deletions are at the hard cap (5)', () => {
    const ops: SyncOp[] = Array.from({ length: 5 }, (_, i) => ({
      action: 'delete-local' as const,
      rel: `audio/file-${i}.mp3`,
    }));
    const result = checkBulkDelete(ops, makeFiles(10), makeFiles(10));
    expect(result.ok).toBe(true);
    expect(result.threshold).toBe(5);
  });

  it('aborts when deletions exceed the hard cap of 5 (with small total file counts)', () => {
    const ops: SyncOp[] = Array.from({ length: 6 }, (_, i) => ({
      action: 'delete-local' as const,
      rel: `audio/file-${i}.mp3`,
    }));
    const result = checkBulkDelete(ops, makeFiles(10), makeFiles(10));
    expect(result.ok).toBe(false);
    expect(result.totalDeletes).toBe(6);
    expect(result.threshold).toBe(5);
    expect(result.reason).toContain('6 deletions');
    expect(result.reason).toContain('5');
  });

  it('aborts at the same cap regardless of total tracked file count (the 2026-05-14 incident)', () => {
    // The previous cap of `max(50, 5% of total)` admitted up to 1400 deletes
    // for a 28k-file library. The flat hard cap of 5 means library size no
    // longer scales the cap — a sync run can never lose more than 5 files.
    const local = makeFiles(14000);
    const nas = makeFiles(14000, 'images');
    const ops: SyncOp[] = Array.from({ length: 6 }, (_, i) => ({
      action: 'delete-local' as const,
      rel: `images/file-${i}.jpg`,
    }));
    const result = checkBulkDelete(ops, local, nas);
    expect(result.ok).toBe(false);
    expect(result.totalDeletes).toBe(6);
    expect(result.threshold).toBe(5);
  });

  it('counts both delete-local and delete-nas ops toward the cap', () => {
    const ops: SyncOp[] = [
      ...Array.from({ length: 3 }, (_, i): SyncOp => ({ action: 'delete-local', rel: `audio/${i}.mp3` })),
      ...Array.from({ length: 3 }, (_, i): SyncOp => ({ action: 'delete-nas', rel: `audio/${i + 30}.mp3` })),
    ];
    const result = checkBulkDelete(ops, makeFiles(100), makeFiles(100));
    expect(result.totalDeletes).toBe(6);
    // 6 > hard cap 5 → not ok
    expect(result.ok).toBe(false);
  });

  it('does not count push/pull toward the cap', () => {
    const ops: SyncOp[] = [
      ...Array.from({ length: 100 }, (_, i): SyncOp => ({ action: 'push', rel: `audio/${i}.mp3` })),
      ...Array.from({ length: 50 }, (_, i): SyncOp => ({ action: 'pull', rel: `audio/${i + 100}.mp3` })),
    ];
    const result = checkBulkDelete(ops, makeFiles(100), makeFiles(100));
    expect(result.ok).toBe(true);
    expect(result.totalDeletes).toBe(0);
  });
});

describe('trashRel and makeRunId (Layer 1 — soft-delete path)', () => {
  it('makeRunId produces a filesystem-safe ISO timestamp (no colons or dots)', () => {
    const id = makeRunId(new Date('2026-05-08T18:45:12.345Z'));
    expect(id).toBe('2026-05-08T18-45-12-345Z');
    expect(id).not.toMatch(/[:.]/);
  });

  it('trashRel preserves directory structure under .trash/<runId>/', () => {
    const id = '2026-05-08T18-45-12-345Z';
    expect(trashRel('images/Personen/Mercer.jpg', id))
      .toBe('.trash/2026-05-08T18-45-12-345Z/images/Personen/Mercer.jpg');
  });

  it('trashRel handles top-level files', () => {
    const id = '2026-05-08T18-45-12-345Z';
    expect(trashRel('audio/song.mp3', id)).toBe('.trash/2026-05-08T18-45-12-345Z/audio/song.mp3');
  });
});

describe('Safety integration: 2026-05 incident regressions', () => {
  it('refuses to mass-delete local images when NAS folder is empty (full pipeline)', () => {
    // Reproduces the original 2026-05-08 bug end-to-end on the pure-function pipeline:
    //   1. computeSyncOps emits delete-local for each missing-on-NAS image
    //   2. applyDeletionSafety strips them (per-folder loss-ratio veto — 100% loss)
    //   3. checkBulkDelete confirms the remaining op set is safe
    const local = new Map<string, FileMeta>([
      ['images/a.jpg', meta('2026-04-01', 1000)],
      ['images/b.jpg', meta('2026-04-01', 1000)],
      ['images/c.jpg', meta('2026-04-01', 1000)],
      ['audio/song.mp3', meta('2026-04-01', 1000)],
    ]);
    const nas = new Map<string, FileMeta>([
      // NAS images/ is empty — the bug scenario
      ['audio/song.mp3', meta('2026-04-01', 1000)],
    ]);
    const prev = {
      'images/a.jpg': '2026-04-01T00:00:00.000Z',
      'images/b.jpg': '2026-04-01T00:00:00.000Z',
      'images/c.jpg': '2026-04-01T00:00:00.000Z',
      'audio/song.mp3': '2026-04-01T00:00:00.000Z',
    };

    const rawOps = computeSyncOps(local, nas, prev);
    const safe = applyDeletionSafety(rawOps, local, nas, prev);
    const bulk = checkBulkDelete(safe.ops, local, nas);

    // Layer 2 stripped the deletes, so the remaining op set has none.
    expect(safe.ops.filter((o) => o.action === 'delete-local')).toEqual([]);
    // Layer 3 also passes (nothing to delete).
    expect(bulk.ok).toBe(true);
  });

  it('refuses to mass-delete on partial NAS data loss (the 2026-05-14 incident)', () => {
    // The "entirely empty" Layer 2 check missed this scenario: 20 prev image
    // entries, NAS still has 17 (≈15% loss). Old code: 3 delete-local ops slip
    // past Layer 2; Layer 3 (max(50, 5%)) also lets them through. Result: 3
    // files trashed. With the new ratio-based Layer 2 (5%) AND the new flat
    // Layer 3 (5), both backstops fire.
    const local = new Map<string, FileMeta>();
    const nas = new Map<string, FileMeta>();
    const prev: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      const rel = `images/photo-${i}.jpg`;
      local.set(rel, meta('2026-04-01', 1000));
      prev[rel] = '2026-04-01T00:00:00.000Z';
      if (i < 17) nas.set(rel, meta('2026-04-01', 1000));
    }

    const rawOps = computeSyncOps(local, nas, prev);
    const safe = applyDeletionSafety(rawOps, local, nas, prev);
    const bulk = checkBulkDelete(safe.ops, local, nas);

    expect(safe.ops.filter((o) => o.action === 'delete-local')).toEqual([]);
    expect(bulk.ok).toBe(true);
  });

  it('Layer 3 backstop fires when a folder loss-ratio is just under threshold but cumulative ops > 5', () => {
    // If two folders each lose 4% (under the 5% per-folder threshold), the
    // deletes slip past Layer 2 — but their total of 8 still trips Layer 3.
    const local = new Map<string, FileMeta>();
    const nas = new Map<string, FileMeta>();
    const prev: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      const a = `images/photo-${i}.jpg`;
      const b = `audio/song-${i}.mp3`;
      local.set(a, meta('2026-04-01', 1000));
      local.set(b, meta('2026-04-01', 1000));
      prev[a] = '2026-04-01T00:00:00.000Z';
      prev[b] = '2026-04-01T00:00:00.000Z';
      if (i >= 4) nas.set(a, meta('2026-04-01', 1000)); // NAS lost 4 images (4%)
      if (i >= 4) nas.set(b, meta('2026-04-01', 1000)); // NAS lost 4 audios (4%)
    }

    const rawOps = computeSyncOps(local, nas, prev);
    const safe = applyDeletionSafety(rawOps, local, nas, prev);
    // Layer 2 lets through (4% < 5%) — 8 delete-local ops survive
    expect(safe.ops.filter((o) => o.action === 'delete-local')).toHaveLength(8);
    // Layer 3 catches: 8 > 5 → aborts
    const bulk = checkBulkDelete(safe.ops, local, nas);
    expect(bulk.ok).toBe(false);
    expect(bulk.totalDeletes).toBe(8);
  });
});
