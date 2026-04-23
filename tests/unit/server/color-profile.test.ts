import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, utimes, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  extractColors,
  getColorProfile,
  colorProfilesPath,
  isSupportedImageForColorProfile,
} from '../../../server/color-profile.js';

async function makePng(dir: string, name: string, tiles: { color: string; w: number; h: number }[]): Promise<string> {
  // Stack the tiles vertically into one PNG so we get deterministic area ratios.
  const width = Math.max(...tiles.map(t => t.w));
  const height = tiles.reduce((s, t) => s + t.h, 0);
  const raw = Buffer.alloc(width * height * 3);
  let y = 0;
  for (const tile of tiles) {
    const n = parseInt(tile.color.slice(1), 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    for (let ty = 0; ty < tile.h; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const offset = ((y + ty) * width + tx) * 3;
        raw[offset] = r;
        raw[offset + 1] = g;
        raw[offset + 2] = b;
      }
    }
    y += tile.h;
  }
  const abs = path.join(dir, name);
  await sharp(raw, { raw: { width, height, channels: 3 } }).png().toFile(abs);
  return abs;
}

async function makeSvg(dir: string, name: string, contents: string): Promise<string> {
  const abs = path.join(dir, name);
  await writeFile(abs, contents, 'utf8');
  return abs;
}

describe('color-profile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'color-profile-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('isSupportedImageForColorProfile', () => {
    it('accepts common raster + svg', () => {
      expect(isSupportedImageForColorProfile('foo.png')).toBe(true);
      expect(isSupportedImageForColorProfile('foo.jpg')).toBe(true);
      expect(isSupportedImageForColorProfile('foo.jpeg')).toBe(true);
      expect(isSupportedImageForColorProfile('foo.webp')).toBe(true);
      expect(isSupportedImageForColorProfile('foo.svg')).toBe(true);
      expect(isSupportedImageForColorProfile('PATH/TO/FOO.SVG')).toBe(true);
    });

    it('rejects unrelated extensions', () => {
      expect(isSupportedImageForColorProfile('foo.gif')).toBe(false);
      expect(isSupportedImageForColorProfile('foo.txt')).toBe(false);
      expect(isSupportedImageForColorProfile('foo')).toBe(false);
    });
  });

  describe('extractColors', () => {
    it('returns a single 100% slice for a solid-color PNG', async () => {
      const abs = await makePng(dir, 'solid.png', [{ color: '#FF0000', w: 40, h: 40 }]);
      const slices = await extractColors(abs);
      expect(slices.length).toBe(1);
      expect(slices[0].percent).toBe(100);
    });

    it('returns proportional slices for a two-tone PNG', async () => {
      // 70% red, 30% green. sharp may introduce a couple of boundary pixels
      // during resize; assert top-2 dominance and total-sum instead of exact count.
      const abs = await makePng(dir, 'two.png', [
        { color: '#FF0000', w: 40, h: 70 },
        { color: '#00FF00', w: 40, h: 30 },
      ]);
      const slices = await extractColors(abs);
      expect(slices.length).toBeGreaterThanOrEqual(2);
      const sum = slices.reduce((s, sl) => s + sl.percent, 0);
      expect(Math.abs(sum - 100)).toBeLessThan(0.2);
      // Top 2 slices should cover the vast majority of the image.
      const top2 = slices[0].percent + slices[1].percent;
      expect(top2).toBeGreaterThan(95);
      // Largest slice must be > 60% (the red region).
      expect(slices[0].percent).toBeGreaterThan(60);
    });

    it('handles SVG input', async () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <rect width="7" height="10" fill="#1E90FF"/>
        <rect x="7" width="3" height="10" fill="#34A853"/>
      </svg>`;
      const abs = await makeSvg(dir, 'logo.svg', svg);
      const slices = await extractColors(abs);
      expect(slices.length).toBeGreaterThanOrEqual(2);
      const sum = slices.reduce((s, sl) => s + sl.percent, 0);
      expect(Math.abs(sum - 100)).toBeLessThan(0.2);
    });

    it('skips transparent pixels instead of flattening them to white', async () => {
      // Transparent PNG with a small red dot — the dot is only ~1% of total
      // pixel area, but it's the only non-transparent content. With the
      // transparency-skip behavior, red should be the dominant (only) slice.
      const raw = Buffer.alloc(100 * 100 * 4);
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < 100; x++) {
          const o = (y * 100 + x) * 4;
          const isDot = x >= 40 && x < 50 && y >= 40 && y < 50;
          raw[o] = isDot ? 255 : 0;
          raw[o + 1] = 0;
          raw[o + 2] = 0;
          raw[o + 3] = isDot ? 255 : 0; // transparent background
        }
      }
      const abs = path.join(dir, 'dot.png');
      await sharp(raw, { raw: { width: 100, height: 100, channels: 4 } }).png().toFile(abs);
      const slices = await extractColors(abs);
      expect(slices.length).toBeGreaterThan(0);
      // The dominant slice must be red-ish, not white.
      const first = slices[0];
      const n = parseInt(first.hex.slice(1), 16);
      const r = (n >> 16) & 0xff;
      const g = (n >> 8) & 0xff;
      const b = n & 0xff;
      expect(r).toBeGreaterThan(g + 100);
      expect(r).toBeGreaterThan(b + 100);
    });
  });

  describe('getColorProfile (cached)', () => {
    it('extracts on cold cache and persists to sidecar', async () => {
      await makePng(dir, 'logo.png', [{ color: '#1E90FF', w: 40, h: 40 }]);
      const slices = await getColorProfile(dir, 'logo.png');
      expect(slices.length).toBeGreaterThan(0);
      expect(existsSync(colorProfilesPath(dir))).toBe(true);

      const raw = await readFile(colorProfilesPath(dir), 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed['logo.png']).toBeDefined();
      expect(parsed['logo.png'].colors.length).toBeGreaterThan(0);
      expect(typeof parsed['logo.png'].mtime).toBe('number');
    });

    it('reuses the cache on a second call for the same mtime', async () => {
      const abs = await makePng(dir, 'logo.png', [{ color: '#1E90FF', w: 40, h: 40 }]);
      const first = await getColorProfile(dir, 'logo.png');
      // Tamper with the cache to prove the second call does NOT re-extract.
      const raw = await readFile(colorProfilesPath(dir), 'utf8');
      const parsed = JSON.parse(raw);
      parsed['logo.png'].colors = [{ hex: '#DEADBE', percent: 100 }];
      await writeFile(colorProfilesPath(dir), JSON.stringify(parsed, null, 2) + '\n', 'utf8');
      // Preserve the mtime of the actual image so the cache is still considered valid.
      const imgStat = await sharp(abs).metadata();
      void imgStat; // only need the side-effect check above
      const second = await getColorProfile(dir, 'logo.png');
      expect(second).toEqual([{ hex: '#DEADBE', percent: 100 }]);
      void first;
    });

    it('invalidates the cache when mtime changes', async () => {
      const abs = await makePng(dir, 'logo.png', [{ color: '#1E90FF', w: 40, h: 40 }]);
      await getColorProfile(dir, 'logo.png');
      // Seed a fake entry in the cache so we can tell when it's re-extracted.
      const raw = await readFile(colorProfilesPath(dir), 'utf8');
      const parsed = JSON.parse(raw);
      parsed['logo.png'].colors = [{ hex: '#DEADBE', percent: 100 }];
      await writeFile(colorProfilesPath(dir), JSON.stringify(parsed, null, 2) + '\n', 'utf8');
      // Bump the image's mtime.
      const future = new Date(Date.now() + 60_000);
      await utimes(abs, future, future);
      const refreshed = await getColorProfile(dir, 'logo.png');
      expect(refreshed).not.toEqual([{ hex: '#DEADBE', percent: 100 }]);
      expect(refreshed.length).toBeGreaterThan(0);
    });

    it('returns [] for a missing file without throwing', async () => {
      const slices = await getColorProfile(dir, 'does-not-exist.png');
      expect(slices).toEqual([]);
    });

    it('strips a leading slash from the relPath', async () => {
      await makePng(dir, 'logo.png', [{ color: '#1E90FF', w: 40, h: 40 }]);
      const slices = await getColorProfile(dir, '/logo.png');
      expect(slices.length).toBeGreaterThan(0);
    });
  });
});
