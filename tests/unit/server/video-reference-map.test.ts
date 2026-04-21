import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, symlink, unlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  readReferenceMap,
  addReference,
  removeReference,
  renameReference,
  pruneStaleReferences,
  referenceMapPath,
  isReference,
} from '../../../server/video-reference-map.js';

describe('video-reference-map', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'video-ref-map-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('readReferenceMap', () => {
    it('returns empty object when file is missing', async () => {
      expect(await readReferenceMap(dir)).toEqual({});
    });

    it('parses a valid map', async () => {
      await writeFile(
        referenceMapPath(dir),
        JSON.stringify({ 'Matrix.mp4': { sourcePath: '/Volumes/NAS/Matrix.mp4', addedAt: 1 } }),
        'utf8',
      );
      const map = await readReferenceMap(dir);
      expect(map['Matrix.mp4']).toEqual({ sourcePath: '/Volumes/NAS/Matrix.mp4', addedAt: 1 });
    });

    it('returns empty object when file is malformed', async () => {
      await writeFile(referenceMapPath(dir), '{ not json', 'utf8');
      expect(await readReferenceMap(dir)).toEqual({});
    });

    it('drops entries missing sourcePath or addedAt', async () => {
      await writeFile(
        referenceMapPath(dir),
        JSON.stringify({
          'ok.mp4': { sourcePath: '/a', addedAt: 1 },
          'no-src.mp4': { addedAt: 1 },
          'no-time.mp4': { sourcePath: '/b' },
          'not-object.mp4': 'nope',
        }),
        'utf8',
      );
      const map = await readReferenceMap(dir);
      expect(Object.keys(map)).toEqual(['ok.mp4']);
    });
  });

  describe('addReference / removeReference / renameReference', () => {
    it('writes and reads back an entry', async () => {
      await addReference(dir, 'Matrix.mp4', '/Volumes/NAS/Matrix.mp4');
      const map = await readReferenceMap(dir);
      expect(map['Matrix.mp4'].sourcePath).toBe('/Volumes/NAS/Matrix.mp4');
      expect(typeof map['Matrix.mp4'].addedAt).toBe('number');
    });

    it('remove returns false for missing key, true when deleted', async () => {
      await addReference(dir, 'a.mp4', '/a');
      expect(await removeReference(dir, 'missing.mp4')).toBe(false);
      expect(await removeReference(dir, 'a.mp4')).toBe(true);
      expect(await readReferenceMap(dir)).toEqual({});
    });

    it('rename moves entry to new key and preserves metadata', async () => {
      await addReference(dir, 'old.mp4', '/Volumes/x/old.mp4');
      await renameReference(dir, 'old.mp4', 'Movies/new.mp4');
      const map = await readReferenceMap(dir);
      expect(map['old.mp4']).toBeUndefined();
      expect(map['Movies/new.mp4'].sourcePath).toBe('/Volumes/x/old.mp4');
    });

    it('rename is a no-op when source key is missing', async () => {
      await renameReference(dir, 'nothing.mp4', 'somewhere.mp4');
      expect(await readReferenceMap(dir)).toEqual({});
    });
  });

  describe('isReference', () => {
    it('reports membership correctly', async () => {
      await addReference(dir, 'x.mp4', '/a');
      const map = await readReferenceMap(dir);
      expect(isReference(map, 'x.mp4')).toBe(true);
      expect(isReference(map, 'y.mp4')).toBe(false);
    });
  });

  describe('pruneStaleReferences', () => {
    it('drops entries whose expected entry no longer exists', async () => {
      await addReference(dir, 'ghost.mp4', '/a');
      const removed = await pruneStaleReferences(dir);
      expect(removed).toEqual(['ghost.mp4']);
      expect(await readReferenceMap(dir)).toEqual({});
    });

    it('keeps entries whose symlink is present (even when dangling)', async () => {
      const linkPath = path.join(dir, 'dangling.mp4');
      await symlink('/nonexistent/target.mp4', linkPath); // dangling but present
      await addReference(dir, 'dangling.mp4', '/nonexistent/target.mp4');
      const removed = await pruneStaleReferences(dir);
      expect(removed).toEqual([]);
      expect((await readReferenceMap(dir))['dangling.mp4']).toBeDefined();
      await unlink(linkPath);
    });
  });

  describe('persistence', () => {
    it('writes with a trailing newline (json hygiene)', async () => {
      await addReference(dir, 'a.mp4', '/a');
      const raw = await readFile(referenceMapPath(dir), 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
    });

    it('stores at the expected .dotfile path', async () => {
      await addReference(dir, 'a.mp4', '/a');
      expect(existsSync(path.join(dir, '.video-references.json'))).toBe(true);
    });
  });
});
