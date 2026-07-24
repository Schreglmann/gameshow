import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  readNasSyncConflicts,
  reconcileNasSyncConflicts,
  getNasSyncConflict,
  removeNasSyncConflict,
  countNasSyncConflicts,
  nasSyncConflictsPath,
  type DetectedConflict,
} from '../../../server/nas-sync-conflicts';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'nas-conflicts-test-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function detected(rel: string, over: Partial<DetectedConflict> = {}): DetectedConflict {
  return {
    rel,
    action: 'delete-local',
    folder: rel.split('/')[0]!,
    reason: 'loss-ratio-veto',
    lossRatio: 0.15,
    runId: 'run-1',
    ...over,
  };
}

describe('readNasSyncConflicts', () => {
  it('returns {} when the sidecar does not exist', async () => {
    expect(await readNasSyncConflicts(tmpRoot)).toEqual({});
  });

  it('returns {} on malformed JSON and drops invalid entries', async () => {
    const file = nasSyncConflictsPath(tmpRoot);
    // valid + invalid mixed
    const now = 1_000;
    await reconcileNasSyncConflicts(tmpRoot, [detected('images/a.jpg')], now);
    // hand-corrupt one entry by rewriting the file
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw['images/bad.jpg'] = { rel: 'images/bad.jpg' }; // missing required fields
    const { writeFileSync } = await import('fs');
    writeFileSync(file, JSON.stringify(raw));
    const map = await readNasSyncConflicts(tmpRoot);
    expect(Object.keys(map)).toEqual(['images/a.jpg']); // invalid dropped
  });
});

describe('reconcileNasSyncConflicts', () => {
  it('writes the sidecar atomically with a trailing newline and 2-space indent', async () => {
    await reconcileNasSyncConflicts(tmpRoot, [detected('images/a.jpg')], 1_000);
    const raw = readFileSync(nasSyncConflictsPath(tmpRoot), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  "images/a.jpg"');
  });

  it('assigns detectedAt = lastSeenAt = now on first sight', async () => {
    const entries = await reconcileNasSyncConflicts(tmpRoot, [detected('images/a.jpg')], 5_000);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ rel: 'images/a.jpg', detectedAt: 5_000, lastSeenAt: 5_000 });
  });

  it('preserves detectedAt but refreshes lastSeenAt on a subsequent run', async () => {
    await reconcileNasSyncConflicts(tmpRoot, [detected('images/a.jpg', { runId: 'run-1' })], 5_000);
    const entries = await reconcileNasSyncConflicts(
      tmpRoot,
      [detected('images/a.jpg', { runId: 'run-2' })],
      9_000,
    );
    expect(entries[0]).toMatchObject({ detectedAt: 5_000, lastSeenAt: 9_000, runId: 'run-2' });
  });

  it('drops conflicts no longer refused (self-healing)', async () => {
    await reconcileNasSyncConflicts(
      tmpRoot,
      [detected('images/a.jpg'), detected('images/b.jpg')],
      1_000,
    );
    // Next run only refuses a.jpg → b.jpg heals and disappears.
    const entries = await reconcileNasSyncConflicts(tmpRoot, [detected('images/a.jpg')], 2_000);
    expect(entries.map((e) => e.rel)).toEqual(['images/a.jpg']);
    expect(await getNasSyncConflict(tmpRoot, 'images/b.jpg')).toBeNull();
  });

  it('clears the whole sidecar when passed an empty array', async () => {
    await reconcileNasSyncConflicts(tmpRoot, [detected('images/a.jpg')], 1_000);
    const entries = await reconcileNasSyncConflicts(tmpRoot, [], 2_000);
    expect(entries).toEqual([]);
    expect(await countNasSyncConflicts(tmpRoot)).toBe(0);
  });

  it('records bulk-cap conflicts without a lossRatio', async () => {
    const entries = await reconcileNasSyncConflicts(
      tmpRoot,
      [detected('audio/x.mp3', { action: 'delete-nas', folder: 'audio', reason: 'bulk-cap', lossRatio: undefined })],
      1_000,
    );
    expect(entries[0]).toMatchObject({ reason: 'bulk-cap', action: 'delete-nas' });
    expect(entries[0].lossRatio).toBeUndefined();
  });
});

describe('getNasSyncConflict / removeNasSyncConflict / countNasSyncConflicts', () => {
  it('reads and removes a single entry, leaving the rest intact', async () => {
    await reconcileNasSyncConflicts(
      tmpRoot,
      [detected('images/a.jpg'), detected('images/b.jpg')],
      1_000,
    );
    expect(await countNasSyncConflicts(tmpRoot)).toBe(2);
    expect(await getNasSyncConflict(tmpRoot, 'images/a.jpg')).toMatchObject({ rel: 'images/a.jpg' });

    await removeNasSyncConflict(tmpRoot, 'images/a.jpg');
    expect(await getNasSyncConflict(tmpRoot, 'images/a.jpg')).toBeNull();
    expect(await countNasSyncConflicts(tmpRoot)).toBe(1);
  });

  it('removeNasSyncConflict is a no-op for an unknown rel', async () => {
    await reconcileNasSyncConflicts(tmpRoot, [detected('images/a.jpg')], 1_000);
    await removeNasSyncConflict(tmpRoot, 'images/missing.jpg');
    expect(await countNasSyncConflicts(tmpRoot)).toBe(1);
  });

  it('countNasSyncConflicts is 0 when the sidecar is absent', async () => {
    expect(await countNasSyncConflicts(tmpRoot)).toBe(0);
    expect(existsSync(nasSyncConflictsPath(tmpRoot))).toBe(false);
  });
});
