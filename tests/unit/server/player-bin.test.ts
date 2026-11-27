import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadPlayerBin, playerBinPath, recordRegistryChange } from '../../../server/player-bin';

const anna = { id: 'anna', firstName: 'Anna', lastName: 'Müller', nickname: 'Anna' };
const ben = { id: 'ben', firstName: 'Ben', lastName: 'Bauer', nickname: 'Ben', disabled: true };

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'player-bin-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('server player bin', () => {
  it('is empty without a file, or with a broken one', async () => {
    expect(await loadPlayerBin(dir)).toEqual([]);
    await writeFile(playerBinPath(dir), '{ nope');
    expect(await loadPlayerBin(dir)).toEqual([]);
  });

  it('bins players a config write removes, and takes restored ones out', async () => {
    await recordRegistryChange(dir, { players: [anna, ben] }, { players: [] });
    expect(await loadPlayerBin(dir)).toEqual([anna, ben]);
    const raw = await readFile(playerBinPath(dir), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ players: [anna, ben] });

    await recordRegistryChange(dir, { players: [] }, { players: [ben] });
    expect(await loadPlayerBin(dir)).toEqual([anna]);
  });

  it('bins nothing when the old config is unreadable, and does not create a file for no change', async () => {
    await recordRegistryChange(dir, null, { players: [anna] });
    await expect(readFile(playerBinPath(dir), 'utf8')).rejects.toThrow();
  });
});
