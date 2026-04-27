import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  readAudioCoverMeta,
  setAudioCoverMeta,
  deleteAudioCoverMeta,
  renameAudioCoverMeta,
  audioCoverMetaPath,
} from '../../../server/audio-cover-meta.js';

describe('audio-cover-meta', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ac-meta-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('readAudioCoverMeta', () => {
    it('returns empty object when file is missing', async () => {
      expect(await readAudioCoverMeta(dir)).toEqual({});
    });

    it('parses a valid map', async () => {
      const payload = { 'a.jpg': { source: 'youtube', setAt: 1714000000000 } };
      await writeFile(audioCoverMetaPath(dir), JSON.stringify(payload), 'utf8');
      expect(await readAudioCoverMeta(dir)).toEqual(payload);
    });

    it('returns empty object on malformed JSON', async () => {
      await writeFile(audioCoverMetaPath(dir), '{ not json', 'utf8');
      expect(await readAudioCoverMeta(dir)).toEqual({});
    });

    it('drops entries with invalid source enum', async () => {
      const payload = {
        'good.jpg': { source: 'itunes', setAt: 1 },
        'bad.jpg': { source: 'spotify', setAt: 1 },
      };
      await writeFile(audioCoverMetaPath(dir), JSON.stringify(payload), 'utf8');
      const got = await readAudioCoverMeta(dir);
      expect(got['good.jpg']).toBeDefined();
      expect(got['bad.jpg']).toBeUndefined();
    });

    it('drops entries with non-numeric setAt', async () => {
      const payload = { 'a.jpg': { source: 'youtube', setAt: 'yesterday' } };
      await writeFile(audioCoverMetaPath(dir), JSON.stringify(payload), 'utf8');
      expect(await readAudioCoverMeta(dir)).toEqual({});
    });

    it('preserves optional origin.pickedFrom', async () => {
      const payload = {
        'a.jpg': { source: 'manual', setAt: 1, origin: { pickedFrom: '/images/Logos/x.jpg' } },
      };
      await writeFile(audioCoverMetaPath(dir), JSON.stringify(payload), 'utf8');
      expect((await readAudioCoverMeta(dir))['a.jpg'].origin?.pickedFrom).toBe('/images/Logos/x.jpg');
    });
  });

  describe('setAudioCoverMeta', () => {
    it('writes a new entry', async () => {
      await setAudioCoverMeta(dir, 'a.jpg', { source: 'youtube', setAt: 100 });
      expect(await readAudioCoverMeta(dir)).toEqual({
        'a.jpg': { source: 'youtube', setAt: 100 },
      });
    });

    it('overwrites an existing entry', async () => {
      await setAudioCoverMeta(dir, 'a.jpg', { source: 'youtube', setAt: 100 });
      await setAudioCoverMeta(dir, 'a.jpg', { source: 'manual', setAt: 200, origin: { pickedFrom: '/images/x.jpg' } });
      const got = await readAudioCoverMeta(dir);
      expect(got['a.jpg'].source).toBe('manual');
      expect(got['a.jpg'].setAt).toBe(200);
      expect(got['a.jpg'].origin?.pickedFrom).toBe('/images/x.jpg');
    });

    it('ignores empty key', async () => {
      await setAudioCoverMeta(dir, '', { source: 'manual', setAt: 1 });
      expect(await readAudioCoverMeta(dir)).toEqual({});
    });

    it('preserves other entries when writing', async () => {
      await setAudioCoverMeta(dir, 'a.jpg', { source: 'youtube', setAt: 1 });
      await setAudioCoverMeta(dir, 'b.jpg', { source: 'itunes', setAt: 2 });
      const got = await readAudioCoverMeta(dir);
      expect(Object.keys(got).sort()).toEqual(['a.jpg', 'b.jpg']);
    });
  });

  describe('deleteAudioCoverMeta', () => {
    it('removes the entry', async () => {
      await setAudioCoverMeta(dir, 'a.jpg', { source: 'youtube', setAt: 1 });
      await deleteAudioCoverMeta(dir, 'a.jpg');
      expect(await readAudioCoverMeta(dir)).toEqual({});
    });

    it('is a no-op for missing key', async () => {
      await setAudioCoverMeta(dir, 'a.jpg', { source: 'youtube', setAt: 1 });
      await deleteAudioCoverMeta(dir, 'missing.jpg');
      expect(await readAudioCoverMeta(dir)).toEqual({
        'a.jpg': { source: 'youtube', setAt: 1 },
      });
    });
  });

  describe('renameAudioCoverMeta', () => {
    it('moves the entry to the new key', async () => {
      await setAudioCoverMeta(dir, 'old.jpg', { source: 'manual', setAt: 1 });
      await renameAudioCoverMeta(dir, 'old.jpg', 'new.jpg');
      const got = await readAudioCoverMeta(dir);
      expect(got['old.jpg']).toBeUndefined();
      expect(got['new.jpg']).toEqual({ source: 'manual', setAt: 1 });
    });

    it('is a no-op when source key is missing', async () => {
      await renameAudioCoverMeta(dir, 'missing.jpg', 'new.jpg');
      expect(await readAudioCoverMeta(dir)).toEqual({});
    });

    it('is a no-op when source equals target', async () => {
      await setAudioCoverMeta(dir, 'a.jpg', { source: 'youtube', setAt: 1 });
      await renameAudioCoverMeta(dir, 'a.jpg', 'a.jpg');
      expect((await readAudioCoverMeta(dir))['a.jpg']).toBeDefined();
    });
  });

  describe('persistence', () => {
    it('writes a trailing newline (JSON hygiene)', async () => {
      await setAudioCoverMeta(dir, 'a.jpg', { source: 'youtube', setAt: 1 });
      const raw = await readFile(audioCoverMetaPath(dir), 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
    });

    it('stores at the expected dotfile path', async () => {
      await setAudioCoverMeta(dir, 'a.jpg', { source: 'youtube', setAt: 1 });
      expect(existsSync(path.join(dir, '.audio-cover-meta.json'))).toBe(true);
    });
  });
});
