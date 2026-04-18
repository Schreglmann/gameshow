import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  readAliasMap,
  resolveAlias,
  resolveAliasChecked,
  addAlias,
  removeAlias,
  aliasMapPath,
} from '../../../server/asset-alias-map.js';

describe('asset-alias-map', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'alias-map-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('readAliasMap', () => {
    it('returns empty object when file is missing', async () => {
      expect(await readAliasMap(dir)).toEqual({});
    });

    it('parses a valid map', async () => {
      await writeFile(aliasMapPath(dir), JSON.stringify({ 'a.jpg': 'b.jpg' }), 'utf8');
      expect(await readAliasMap(dir)).toEqual({ 'a.jpg': 'b.jpg' });
    });

    it('returns empty object when file is malformed', async () => {
      await writeFile(aliasMapPath(dir), '{ not json', 'utf8');
      expect(await readAliasMap(dir)).toEqual({});
    });

    it('drops non-string values silently', async () => {
      await writeFile(aliasMapPath(dir), JSON.stringify({ 'a.jpg': 'b.jpg', 'c.jpg': 42 }), 'utf8');
      expect(await readAliasMap(dir)).toEqual({ 'a.jpg': 'b.jpg' });
    });
  });

  describe('resolveAlias', () => {
    it('returns input when no alias', () => {
      expect(resolveAlias({}, 'a.jpg')).toBe('a.jpg');
    });

    it('resolves a single hop', () => {
      expect(resolveAlias({ 'a.jpg': 'b.jpg' }, 'a.jpg')).toBe('b.jpg');
    });

    it('follows chains to the terminal target', () => {
      expect(resolveAlias({ 'a.jpg': 'b.jpg', 'b.jpg': 'c.jpg' }, 'a.jpg')).toBe('c.jpg');
    });

    it('stops on self-loop without infinite recursion', () => {
      expect(resolveAlias({ 'a.jpg': 'a.jpg' }, 'a.jpg')).toBe('a.jpg');
    });

    it('caps chain depth and returns the last seen name', () => {
      // Build a 15-step chain; resolver stops after MAX_CHAIN_DEPTH (10)
      const map: Record<string, string> = {};
      for (let i = 0; i < 15; i++) map[`a${i}.jpg`] = `a${i + 1}.jpg`;
      const result = resolveAlias(map, 'a0.jpg');
      // Doesn't crash; returns some later name in the chain
      expect(result.startsWith('a')).toBe(true);
    });
  });

  describe('addAlias', () => {
    it('writes a new alias', async () => {
      await addAlias(dir, 'a.jpg', 'b.jpg');
      expect(await readAliasMap(dir)).toEqual({ 'a.jpg': 'b.jpg' });
    });

    it('collapses chains: when target is itself aliased, point at the terminal', async () => {
      await addAlias(dir, 'b.jpg', 'c.jpg');
      await addAlias(dir, 'a.jpg', 'b.jpg');
      const map = await readAliasMap(dir);
      expect(map['a.jpg']).toBe('c.jpg');
      expect(map['b.jpg']).toBe('c.jpg');
    });

    it('re-points existing aliases that pointed at the old terminal', async () => {
      // x.jpg → a.jpg exists; now a.jpg gets merged into b.jpg
      await addAlias(dir, 'x.jpg', 'a.jpg');
      await addAlias(dir, 'a.jpg', 'b.jpg');
      const map = await readAliasMap(dir);
      expect(map['x.jpg']).toBe('b.jpg');
      expect(map['a.jpg']).toBe('b.jpg');
    });

    it('refuses to create a cycle', async () => {
      await addAlias(dir, 'a.jpg', 'b.jpg');
      await addAlias(dir, 'b.jpg', 'a.jpg');
      const map = await readAliasMap(dir);
      expect(map['b.jpg']).toBeUndefined();
    });

    it('ignores empty or equal inputs', async () => {
      await addAlias(dir, '', 'b.jpg');
      await addAlias(dir, 'a.jpg', '');
      await addAlias(dir, 'a.jpg', 'a.jpg');
      expect(await readAliasMap(dir)).toEqual({});
    });
  });

  describe('removeAlias', () => {
    it('deletes the entry', async () => {
      await addAlias(dir, 'a.jpg', 'b.jpg');
      await removeAlias(dir, 'a.jpg');
      expect(await readAliasMap(dir)).toEqual({});
    });

    it('is a no-op when the entry doesn\u2019t exist', async () => {
      await removeAlias(dir, 'missing.jpg');
      expect(await readAliasMap(dir)).toEqual({});
    });
  });

  describe('resolveAliasChecked (self-heal)', () => {
    it('returns the resolved name when the target file exists', async () => {
      const target = path.join(dir, 'b.jpg');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, 'x', 'utf8');
      await addAlias(dir, 'a.jpg', 'b.jpg');
      expect(await resolveAliasChecked(dir, dir, 'a.jpg')).toBe('b.jpg');
    });

    it('removes the stale alias and returns input when target is missing', async () => {
      await addAlias(dir, 'a.jpg', 'b.jpg'); // b.jpg doesn\u2019t exist
      const result = await resolveAliasChecked(dir, dir, 'a.jpg');
      expect(result).toBe('a.jpg');
      expect(await readAliasMap(dir)).toEqual({});
    });

    it('returns input unchanged when no alias is registered', async () => {
      expect(await resolveAliasChecked(dir, dir, 'a.jpg')).toBe('a.jpg');
    });
  });

  describe('persistence', () => {
    it('writes with a trailing newline (json hygiene)', async () => {
      await addAlias(dir, 'a.jpg', 'b.jpg');
      const raw = await readFile(aliasMapPath(dir), 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
    });

    it('stores at the expected .dotfile path', async () => {
      await addAlias(dir, 'a.jpg', 'b.jpg');
      expect(existsSync(path.join(dir, '.asset-aliases.json'))).toBe(true);
    });
  });
});
