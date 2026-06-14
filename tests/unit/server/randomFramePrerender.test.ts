import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  prerenderedDir,
  prerenderManifestFile,
  prerenderedFileName,
  prerenderKey,
  loadPrerenderManifest,
  savePrerenderManifest,
  selectPrerenderedFile,
  selectPrerenderedSlot,
} from '../../../server/random-frame-prerender.js';

describe('random-frame prerender manifest', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'rf-prerender-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('derives stable paths, keys and filenames', () => {
    expect(prerenderedDir(dir)).toBe(path.join(dir, 'prerendered'));
    expect(prerenderManifestFile(dir)).toBe(path.join(dir, '.prerender.json'));
    // filename is per (slug, question index, variant)
    expect(prerenderedFileName('Movies__Film', 3, 2)).toBe('Movies__Film__q3__p2.jpg');
    // the same movie at different question indices gets distinct keys + filenames
    expect(prerenderKey('Movies/Film.mkv', 2)).toBe('Movies/Film.mkv#2');
    expect(prerenderKey('Movies/Film.mkv', 4)).toBe('Movies/Film.mkv#4');
    expect(prerenderedFileName('Movies__Film', 2, 0)).not.toBe(prerenderedFileName('Movies__Film', 4, 0));
  });

  it('returns an empty map when no manifest exists', () => {
    expect(loadPrerenderManifest(dir).size).toBe(0);
  });

  it('round-trips through save + load (incl. the first marker)', () => {
    const map = new Map([
      ['Movies/Film.mkv#0', { files: ['a__p0.jpg', 'a__p1.jpg', 'a__p2.jpg'], first: 2 }],
    ]);
    savePrerenderManifest(dir, map);
    const loaded = loadPrerenderManifest(dir);
    expect(loaded.get('Movies/Film.mkv#0')?.files).toEqual(['a__p0.jpg', 'a__p1.jpg', 'a__p2.jpg']);
    expect(loaded.get('Movies/Film.mkv#0')?.first).toBe(2);
  });

  it('clamps an out-of-range first marker to 0 on load', () => {
    writeFileSync(prerenderManifestFile(dir), JSON.stringify({
      a: { files: ['p0.jpg', 'p1.jpg'], first: 9 },
      b: { files: ['p0.jpg', 'p1.jpg'], first: 1 },
    }));
    const loaded = loadPrerenderManifest(dir);
    expect(loaded.get('a')?.first).toBe(0); // out of range → 0
    expect(loaded.get('b')?.first).toBe(1);
  });

  it('ignores malformed entries on load', () => {
    writeFileSync(prerenderManifestFile(dir), JSON.stringify({
      good: { files: ['x__p0.jpg'] },
      bad: { nope: true },
      alsoBad: { files: [1, 'y__p0.jpg'] },
    }));
    const loaded = loadPrerenderManifest(dir);
    expect(loaded.get('good')?.files).toEqual(['x__p0.jpg']);
    expect(loaded.has('bad')).toBe(false);
    expect(loaded.get('alsoBad')?.files).toEqual(['y__p0.jpg']); // non-strings filtered out
  });

  describe('selectPrerenderedFile', () => {
    const writeVariants = (names: string[]) => {
      mkdirSync(prerenderedDir(dir), { recursive: true });
      for (const n of names) writeFileSync(path.join(prerenderedDir(dir), n), 'jpeg');
    };

    it('returns null without an entry or files', () => {
      expect(selectPrerenderedFile(dir, undefined, 0)).toBeNull();
      expect(selectPrerenderedFile(dir, { files: [] }, 0)).toBeNull();
    });

    it('cycles variants with modulo and supports rotate past the count (first=0)', () => {
      writeVariants(['v0.jpg', 'v1.jpg', 'v2.jpg']);
      const entry = { files: ['v0.jpg', 'v1.jpg', 'v2.jpg'] };
      const pick = (v: number) => path.basename(selectPrerenderedFile(dir, entry, v)!);
      expect(pick(0)).toBe('v0.jpg');
      expect(pick(1)).toBe('v1.jpg');
      expect(pick(2)).toBe('v2.jpg');
      expect(pick(3)).toBe('v0.jpg'); // wraps
      expect(pick(4)).toBe('v1.jpg');
    });

    it('offsets the rotation by the first marker (order unchanged)', () => {
      writeVariants(['v0.jpg', 'v1.jpg', 'v2.jpg']);
      const entry = { files: ['v0.jpg', 'v1.jpg', 'v2.jpg'], first: 2 };
      const pick = (v: number) => path.basename(selectPrerenderedFile(dir, entry, v)!);
      expect(pick(0)).toBe('v2.jpg'); // variant 0 = the marked-first frame
      expect(pick(1)).toBe('v0.jpg'); // then walks the rest in stable order
      expect(pick(2)).toBe('v1.jpg');
    });

    it('selectPrerenderedSlot addresses raw files regardless of the first marker', () => {
      writeVariants(['v0.jpg', 'v1.jpg', 'v2.jpg']);
      const entry = { files: ['v0.jpg', 'v1.jpg', 'v2.jpg'], first: 2 };
      expect(path.basename(selectPrerenderedSlot(dir, entry, 0)!)).toBe('v0.jpg');
      expect(path.basename(selectPrerenderedSlot(dir, entry, 1)!)).toBe('v1.jpg');
      expect(path.basename(selectPrerenderedSlot(dir, entry, 2)!)).toBe('v2.jpg');
    });

    it('returns null when the selected file is missing on disk', () => {
      // manifest references a file that was never written
      expect(selectPrerenderedFile(dir, { files: ['ghost.jpg'] }, 0)).toBeNull();
      expect(selectPrerenderedSlot(dir, { files: ['ghost.jpg'] }, 0)).toBeNull();
    });
  });
});
