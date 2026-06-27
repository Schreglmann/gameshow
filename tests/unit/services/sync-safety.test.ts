import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { pruneTrash, softDelete } from '../../../server/sync-safety';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'sync-safety-test-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFile(rel: string, content = 'hello'): void {
  const full = path.join(tmpRoot, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('softDelete', () => {
  it('moves the file under .trash/<runId>/ preserving the original layout', async () => {
    writeFile('images/Personen/Mercer.jpg', 'jpeg-bytes');
    await softDelete(tmpRoot, 'images/Personen/Mercer.jpg', 'run-1');

    const original = path.join(tmpRoot, 'images/Personen/Mercer.jpg');
    const trashed = path.join(tmpRoot, '.trash/run-1/images/Personen/Mercer.jpg');
    expect(existsSync(original)).toBe(false);
    expect(existsSync(trashed)).toBe(true);
    expect(readFileSync(trashed, 'utf8')).toBe('jpeg-bytes');
  });

  it('is idempotent when the source no longer exists (treats as success)', async () => {
    await expect(softDelete(tmpRoot, 'images/missing.jpg', 'run-1')).resolves.not.toThrow();
    expect(existsSync(path.join(tmpRoot, '.trash'))).toBe(false); // nothing to move
  });

  it('appends a numeric suffix when the trash target already exists', async () => {
    writeFile('images/dup.jpg', 'first');
    await softDelete(tmpRoot, 'images/dup.jpg', 'run-1');

    // Simulate a second pass that would write to the same trash target
    writeFile('images/dup.jpg', 'second');
    await softDelete(tmpRoot, 'images/dup.jpg', 'run-1');

    const target1 = path.join(tmpRoot, '.trash/run-1/images/dup.jpg');
    const target2 = path.join(tmpRoot, '.trash/run-1/images/dup.jpg.1');
    expect(readFileSync(target1, 'utf8')).toBe('first');
    expect(readFileSync(target2, 'utf8')).toBe('second');
  });

  it('creates intermediate trash directories as needed', async () => {
    writeFile('audio/Deep/Nested/path/file.mp3');
    await softDelete(tmpRoot, 'audio/Deep/Nested/path/file.mp3', 'run-1');
    expect(existsSync(path.join(tmpRoot, '.trash/run-1/audio/Deep/Nested/path/file.mp3'))).toBe(true);
  });
});

describe('pruneTrash', () => {
  it('removes run-id directories older than maxAgeDays', async () => {
    const trashDir = path.join(tmpRoot, '.trash');
    mkdirSync(path.join(trashDir, 'old-run/images'), { recursive: true });
    writeFileSync(path.join(trashDir, 'old-run/images/file.jpg'), 'old');
    mkdirSync(path.join(trashDir, 'new-run/images'), { recursive: true });
    writeFileSync(path.join(trashDir, 'new-run/images/file.jpg'), 'new');

    // Backdate the old-run mtime to 60 days ago
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    utimesSync(path.join(trashDir, 'old-run'), sixtyDaysAgo, sixtyDaysAgo);

    await pruneTrash(tmpRoot, 30);

    expect(existsSync(path.join(trashDir, 'old-run'))).toBe(false);
    expect(existsSync(path.join(trashDir, 'new-run'))).toBe(true);
  });

  it('is a no-op when .trash does not exist', async () => {
    await expect(pruneTrash(tmpRoot, 30)).resolves.not.toThrow();
  });

  it('keeps recently-mtime\'d directories', async () => {
    const trashDir = path.join(tmpRoot, '.trash');
    mkdirSync(path.join(trashDir, 'recent-run/audio'), { recursive: true });
    writeFileSync(path.join(trashDir, 'recent-run/audio/song.mp3'), 'data');

    await pruneTrash(tmpRoot, 30);

    expect(existsSync(path.join(trashDir, 'recent-run'))).toBe(true);
  });

  it('skips non-directory entries inside .trash silently', async () => {
    const trashDir = path.join(tmpRoot, '.trash');
    mkdirSync(trashDir, { recursive: true });
    writeFileSync(path.join(trashDir, 'README'), 'leftover file at trash root');
    await expect(pruneTrash(tmpRoot, 30)).resolves.not.toThrow();
    expect(existsSync(path.join(trashDir, 'README'))).toBe(true);
  });

  it('does not crash when .trash exists as a file instead of a directory', async () => {
    // A stray file at <base>/.trash (failed copy, manual mistake) would make
    // readdir throw ENOTDIR; pruneTrash must return cleanly with a clear
    // warning instead of leaving sync runs unable to call pruneTrash on boot.
    writeFileSync(path.join(tmpRoot, '.trash'), 'oops');
    await expect(pruneTrash(tmpRoot, 30)).resolves.not.toThrow();
    // The bogus file is left intact — pruneTrash is read-only on unexpected shapes.
    expect(existsSync(path.join(tmpRoot, '.trash'))).toBe(true);
  });
});

describe('integration: softDelete then pruneTrash recoverability window', () => {
  it('files moved to .trash within the retention window are recoverable', async () => {
    writeFile('images/keep.jpg', 'still-recoverable');
    await softDelete(tmpRoot, 'images/keep.jpg', 'run-recent');

    // Pruning within retention window leaves the file intact.
    await pruneTrash(tmpRoot, 30);

    const recoveryPath = path.join(tmpRoot, '.trash/run-recent/images/keep.jpg');
    expect(existsSync(recoveryPath)).toBe(true);
    expect(readFileSync(recoveryPath, 'utf8')).toBe('still-recoverable');

    // statSync confirms the file is intact and prunable later
    expect(statSync(recoveryPath).size).toBeGreaterThan(0);
  });
});
