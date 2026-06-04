import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, readdir, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { materializeExamples, EXAMPLE_GAMES } from '../../../server/example-games';
import type { AppConfig } from '../../../src/types/config';

/**
 * Integration test for materializeExamples (specs/example-games.md). This runs
 * the REAL media generation (sharp + ffmpeg-static), so it writes actual PNGs
 * and MP3s into a throwaway temp dir.
 */

describe('materializeExamples (generates real media)', () => {
  let tmpDir: string;
  let gamesDir: string;
  let localAssetsBase: string;
  let configPath: string;
  let result: { createdGames: string[]; gameshow: string };

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'example-games-'));
    gamesDir = path.join(tmpDir, 'games');
    localAssetsBase = path.join(tmpDir, 'local-assets');
    configPath = path.join(tmpDir, 'config.json');
    result = await materializeExamples({ gamesDir, localAssetsBase, configPath });
  }, 60_000);

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates one valid game file per fixture', async () => {
    expect(result.createdGames.length).toBe(EXAMPLE_GAMES.length);
    const files = (await readdir(gamesDir)).filter(f => f.endsWith('.json'));
    expect(files.length).toBe(EXAMPLE_GAMES.length);
    for (const g of EXAMPLE_GAMES) {
      const raw = await readFile(path.join(gamesDir, `${g.fileName}.json`), 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
      expect(JSON.parse(raw).type).toBe(g.gameFile.type);
    }
  });

  it('generates non-empty media for every referenced asset', async () => {
    const dests = new Set<string>();
    for (const g of EXAMPLE_GAMES) for (const m of g.media ?? []) dests.add(m.dest);
    expect(dests.size).toBeGreaterThan(0);
    for (const dest of dests) {
      const s = await stat(path.join(localAssetsBase, dest));
      expect(s.size, `${dest} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('writes a config with the active "beispiele" gameshow referencing all games', async () => {
    const config = JSON.parse(await readFile(configPath, 'utf8')) as AppConfig;
    expect(config.activeGameshow).toBe('beispiele');
    expect(config.gameshows.beispiele.name).toBe('Beispiele');
    expect(config.gameshows.beispiele.gameOrder.length).toBe(EXAMPLE_GAMES.length);
  });

  it('orders final-style games (bet-quiz, quizjagd, final-quiz) at the END of the gameOrder', async () => {
    const config = JSON.parse(await readFile(configPath, 'utf8')) as AppConfig;
    const order = config.gameshows.beispiele.gameOrder;
    const FINAL = new Set(['bet-quiz', 'quizjagd', 'final-quiz']);
    const typeOf = (fileName: string) =>
      EXAMPLE_GAMES.find(g => g.fileName === fileName)!.gameFile.type;
    const finalIdx = order.map((fn, i) => ({ i, final: FINAL.has(typeOf(fn)) }));
    const lastNonFinal = Math.max(...finalIdx.filter(x => !x.final).map(x => x.i));
    const firstFinal = Math.min(...finalIdx.filter(x => x.final).map(x => x.i));
    // Every final-type game comes after every non-final one.
    expect(firstFinal).toBeGreaterThan(lastNonFinal);
    // The three final types are exactly the tail of the order.
    expect(new Set(order.slice(-3).map(typeOf))).toEqual(FINAL);
  });

  it('is idempotent — a second run overwrites without error', async () => {
    const again = await materializeExamples({ gamesDir, localAssetsBase, configPath });
    expect(again.createdGames.length).toBe(EXAMPLE_GAMES.length);
    const config = JSON.parse(await readFile(configPath, 'utf8')) as AppConfig;
    expect(config.gameshows.beispiele.gameOrder.length).toBe(EXAMPLE_GAMES.length);
  });
});
