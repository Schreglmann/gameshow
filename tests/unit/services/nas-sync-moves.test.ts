import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  readPendingMoves,
  recordPendingMove,
  clearPendingMove,
  savePendingMoves,
  countPendingMoves,
  nasSyncMovesPath,
  expirePendingMoves,
  computeMovedAwayRels,
  type PendingMove,
  type PendingMoveMap,
} from '../../../server/nas-sync-moves';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'nas-moves-test-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ── Sidecar CRUD ──

describe('readPendingMoves', () => {
  it('returns {} when the sidecar does not exist', async () => {
    expect(await readPendingMoves(tmpRoot)).toEqual({});
  });

  it('drops malformed entries on read', async () => {
    await recordPendingMove(tmpRoot, 'images/A', 'images/B', 1_000);
    const file = nasSyncMovesPath(tmpRoot);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw['images/bad'] = { relFrom: 'images/bad' }; // missing required fields
    const { writeFileSync } = await import('fs');
    writeFileSync(file, JSON.stringify(raw));
    expect(Object.keys(await readPendingMoves(tmpRoot))).toEqual(['images/A']);
  });
});

describe('recordPendingMove', () => {
  it('writes atomically with a trailing newline and 2-space indent', async () => {
    await recordPendingMove(tmpRoot, 'images/A', 'images/B', 1_000);
    const raw = readFileSync(nasSyncMovesPath(tmpRoot), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  "images/A"');
  });

  it('records relFrom → relTo keyed by relFrom with detectedAt = lastSeenAt = now', async () => {
    await recordPendingMove(tmpRoot, 'images/A', 'images/B', 5_000);
    const map = await readPendingMoves(tmpRoot);
    expect(map['images/A']).toMatchObject({ relFrom: 'images/A', relTo: 'images/B', detectedAt: 5_000, lastSeenAt: 5_000 });
  });

  it('ignores a no-op move where relFrom === relTo', async () => {
    await recordPendingMove(tmpRoot, 'images/A', 'images/A', 1_000);
    expect(await countPendingMoves(tmpRoot)).toBe(0);
  });

  it('NFC-normalizes relFrom and relTo', async () => {
    // "Ö" composed (NFC) vs "O + combining diaeresis" (NFD)
    const nfd = 'audio/Ö.mp3';
    await recordPendingMove(tmpRoot, nfd, 'audio/x.mp3', 1_000);
    const keys = Object.keys(await readPendingMoves(tmpRoot));
    expect(keys[0]).toBe('audio/Ö.mp3'.normalize('NFC'));
    expect(keys[0]!.normalize('NFC')).toBe(keys[0]);
  });

  it('preserves detectedAt but refreshes lastSeenAt when the same relFrom is recorded again', async () => {
    await recordPendingMove(tmpRoot, 'images/A', 'images/B', 5_000);
    await recordPendingMove(tmpRoot, 'images/A', 'images/C', 9_000);
    const map = await readPendingMoves(tmpRoot);
    expect(map['images/A']).toMatchObject({ relTo: 'images/C', detectedAt: 5_000, lastSeenAt: 9_000 });
  });

  // ── Linear chain-collapse ──

  it('collapses A→B then B→C into a single A→C entry', async () => {
    await recordPendingMove(tmpRoot, 'images/A', 'images/B', 5_000);
    await recordPendingMove(tmpRoot, 'images/B', 'images/C', 9_000);
    const map = await readPendingMoves(tmpRoot);
    expect(Object.keys(map)).toEqual(['images/A']);
    expect(map['images/A']).toMatchObject({ relFrom: 'images/A', relTo: 'images/C', detectedAt: 5_000, lastSeenAt: 9_000 });
  });

  it('does not collapse an unrelated second move', async () => {
    await recordPendingMove(tmpRoot, 'images/A', 'images/B', 1_000);
    await recordPendingMove(tmpRoot, 'audio/X', 'audio/Y', 2_000);
    expect(Object.keys(await readPendingMoves(tmpRoot)).sort()).toEqual(['audio/X', 'images/A']);
  });
});

describe('clearPendingMove', () => {
  it('removes a single entry, leaving the rest intact', async () => {
    await recordPendingMove(tmpRoot, 'images/A', 'images/B', 1_000);
    await recordPendingMove(tmpRoot, 'audio/X', 'audio/Y', 1_000);
    await clearPendingMove(tmpRoot, 'images/A');
    expect(Object.keys(await readPendingMoves(tmpRoot))).toEqual(['audio/X']);
  });

  it('is a no-op for an unknown relFrom', async () => {
    await recordPendingMove(tmpRoot, 'images/A', 'images/B', 1_000);
    await clearPendingMove(tmpRoot, 'images/missing');
    expect(await countPendingMoves(tmpRoot)).toBe(1);
  });

  it('normalizes the key so an NFD arg clears an NFC entry', async () => {
    await recordPendingMove(tmpRoot, 'audio/Ö.mp3'.normalize('NFC'), 'audio/x.mp3', 1_000);
    await clearPendingMove(tmpRoot, 'audio/Ö.mp3');
    expect(await countPendingMoves(tmpRoot)).toBe(0);
  });
});

describe('savePendingMoves / countPendingMoves', () => {
  it('savePendingMoves round-trips a map and count reflects it', async () => {
    const map: PendingMoveMap = {
      'images/A': { relFrom: 'images/A', relTo: 'images/B', detectedAt: 1, lastSeenAt: 2 },
    };
    await savePendingMoves(tmpRoot, map);
    expect(await readPendingMoves(tmpRoot)).toEqual(map);
    expect(await countPendingMoves(tmpRoot)).toBe(1);
  });

  it('count is 0 when the sidecar is absent', async () => {
    expect(await countPendingMoves(tmpRoot)).toBe(0);
    expect(existsSync(nasSyncMovesPath(tmpRoot))).toBe(false);
  });
});

// ── expirePendingMoves (pure) ──

describe('expirePendingMoves', () => {
  const mk = (relFrom: string, detectedAt: number): PendingMove => ({
    relFrom, relTo: `${relFrom}-new`, detectedAt, lastSeenAt: detectedAt,
  });

  it('keeps young moves and expires old ones by detectedAt', () => {
    const map: PendingMoveMap = { young: mk('young', 9_000), old: mk('old', 1_000) };
    const { kept, expired } = expirePendingMoves(map, 10_000, 5_000);
    expect(Object.keys(kept)).toEqual(['young']);
    expect(expired.map(e => e.relFrom)).toEqual(['old']);
  });

  it('expires exactly at the TTL boundary (>=)', () => {
    const map: PendingMoveMap = { edge: mk('edge', 5_000) };
    const { kept, expired } = expirePendingMoves(map, 10_000, 5_000);
    expect(kept).toEqual({});
    expect(expired).toHaveLength(1);
  });
});

// ── computeMovedAwayRels (pure — the safety invariant) ──

describe('computeMovedAwayRels', () => {
  const move = (relFrom: string, relTo: string): PendingMove => ({ relFrom, relTo, detectedAt: 0, lastSeenAt: 0 });

  it('excludes a moved folder\'s delete-nas rels when the destination exists locally', () => {
    const moves = [move('images/Alt', 'images/Neu')];
    const local = new Set(['images/Neu/a.jpg', 'images/Neu/b.jpg']);
    const deleteNas = new Set(['images/Alt/a.jpg', 'images/Alt/b.jpg']);
    expect(computeMovedAwayRels(moves, local, deleteNas)).toEqual(
      new Set(['images/Alt/a.jpg', 'images/Alt/b.jpg']),
    );
  });

  it('SAFETY: does NOT exclude a co-located genuine loss (no matching move / no dest locally)', () => {
    const moves = [move('images/Alt', 'images/Neu')];
    const local = new Set(['images/Neu/a.jpg']); // only the moved file landed
    // b.jpg was genuinely deleted; other/c.jpg is unrelated loss
    const deleteNas = new Set(['images/Alt/a.jpg', 'images/Alt/b.jpg', 'images/other/c.jpg']);
    const out = computeMovedAwayRels(moves, local, deleteNas);
    expect(out).toEqual(new Set(['images/Alt/a.jpg']));
    // the genuine losses remain (will still count toward Layer 3 / Layer 2)
    expect(out.has('images/Alt/b.jpg')).toBe(false);
    expect(out.has('images/other/c.jpg')).toBe(false);
  });

  it('SAFETY: does NOT exclude when the destination file is missing locally', () => {
    const moves = [move('images/Alt', 'images/Neu')];
    const local = new Set<string>(); // nothing on disk at the new path
    const deleteNas = new Set(['images/Alt/a.jpg']);
    expect(computeMovedAwayRels(moves, local, deleteNas)).toEqual(new Set());
  });

  it('handles a single-file move (relFrom/relTo are files, not folders)', () => {
    const moves = [move('images/b.jpg', 'images/a.jpg')];
    const local = new Set(['images/a.jpg']);
    const deleteNas = new Set(['images/b.jpg']);
    expect(computeMovedAwayRels(moves, local, deleteNas)).toEqual(new Set(['images/b.jpg']));
  });

  it('handles a cross-category move (audio → background-music)', () => {
    const moves = [move('audio/Set', 'background-music/Set')];
    const local = new Set(['background-music/Set/x.mp3']);
    const deleteNas = new Set(['audio/Set/x.mp3']);
    expect(computeMovedAwayRels(moves, local, deleteNas)).toEqual(new Set(['audio/Set/x.mp3']));
  });

  it('resolves a chained A→C move (post chain-collapse) against local files under C', () => {
    const moves = [move('images/A', 'images/C')];
    const local = new Set(['images/C/x.jpg']);
    const deleteNas = new Set(['images/A/x.jpg']); // NAS still holds the original A
    expect(computeMovedAwayRels(moves, local, deleteNas)).toEqual(new Set(['images/A/x.jpg']));
  });

  it('returns empty when there are no moves or no delete-nas ops', () => {
    expect(computeMovedAwayRels([], new Set(['images/a.jpg']), new Set(['images/a.jpg']))).toEqual(new Set());
    expect(computeMovedAwayRels([move('a', 'b')], new Set(['b/x']), new Set())).toEqual(new Set());
  });

  it('does not exclude a prefix false-match (images/Altbau is not under images/Alt)', () => {
    const moves = [move('images/Alt', 'images/Neu')];
    const local = new Set(['images/Neu/a.jpg']);
    // images/Altbau/… must NOT be treated as under images/Alt
    const deleteNas = new Set(['images/Altbau/a.jpg']);
    expect(computeMovedAwayRels(moves, local, deleteNas)).toEqual(new Set());
  });
});
