/**
 * The local player bin, `players-bin.json` next to config.json (gitignored):
 * players who left the registry, kept so they can be added again by a name
 * typed in full. Written on every config write that changes the registry —
 * BEFORE the config itself, so the reload that config change triggers already
 * reads the new bin. The pure rules live in src/utils/playerBin.ts.
 * See specs/players.md ("Player bin").
 */
import { readFile, rename, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Player } from '../src/types/config.js';
import { normalizeBin, updateBin } from '../src/utils/playerBin.js';

export function playerBinPath(rootDir: string): string {
  return path.join(rootDir, 'players-bin.json');
}

/** The binned players; a missing or broken file is an empty bin. */
export async function loadPlayerBin(rootDir: string): Promise<Player[]> {
  try {
    return normalizeBin(JSON.parse(await readFile(playerBinPath(rootDir), 'utf8')));
  } catch {
    return [];
  }
}

async function savePlayerBin(rootDir: string, players: readonly Player[]): Promise<void> {
  const file = playerBinPath(rootDir);
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify({ players }, null, 2) + '\n', 'utf8');
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => { /* tmp may already be gone */ });
    throw err;
  }
}

/** The `players` of a parsed config, or `[]` for anything else. */
function registryOf(config: unknown): Player[] {
  const players = config && typeof config === 'object' ? (config as { players?: unknown }).players : undefined;
  return normalizeBin({ players });
}

/**
 * Bin the players a config write removes from the registry, and take out the
 * ones it brings back. `before` / `after` are the parsed configs (anything —
 * an unreadable old config bins nothing). Call it before writing the config.
 */
export async function recordRegistryChange(rootDir: string, before: unknown, after: unknown): Promise<void> {
  const bin = await loadPlayerBin(rootDir);
  const next = updateBin(bin, registryOf(before), registryOf(after));
  if (next !== bin) await savePlayerBin(rootDir, next);
}
