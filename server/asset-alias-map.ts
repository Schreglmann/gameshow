/**
 * Asset alias map — records that a derived asset filename (e.g. an auto-generated
 * audio cover or movie poster) has been merged into another filename. Consulted
 * by the auto-downloaders before they check for existence, so a cover that was
 * merged away won't be re-downloaded on the next run.
 *
 * Stored as a dotfile inside the images category so it's excluded from DAM
 * listings by the existing `e.name.startsWith('.')` filter.
 *
 * Shape: flat basename → basename map. Both keys and values are bare filenames
 * (no directory component), matching the output of `audioCoverFilename` and
 * `videoFilenameToSlug + '.jpg'`.
 */

import path from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';

export type AliasMap = Record<string, string>;

const MAX_CHAIN_DEPTH = 10;

export function aliasMapPath(imagesCategoryDir: string): string {
  return path.join(imagesCategoryDir, '.asset-aliases.json');
}

export async function readAliasMap(imagesCategoryDir: string): Promise<AliasMap> {
  const file = aliasMapPath(imagesCategoryDir);
  if (!existsSync(file)) return {};
  try {
    const raw = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: AliasMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeAliasMap(imagesCategoryDir: string, map: AliasMap): Promise<void> {
  const file = aliasMapPath(imagesCategoryDir);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/**
 * Resolve a filename through the alias map, following chains.
 * Returns the terminal target, or the input unchanged if no alias exists.
 */
export function resolveAlias(map: AliasMap, name: string): string {
  let cur = name;
  for (let i = 0; i < MAX_CHAIN_DEPTH; i++) {
    const next = map[cur];
    if (!next || next === cur) return cur;
    cur = next;
  }
  return cur;
}

/**
 * Record that `from` should resolve to `to`. Collapses chains: if `to` is
 * itself aliased, the new entry points directly at `to`'s terminal target.
 * If the resulting target equals `from`, the entry is not written (would be a cycle).
 */
export async function addAlias(imagesCategoryDir: string, from: string, to: string): Promise<void> {
  if (!from || !to || from === to) return;
  const map = await readAliasMap(imagesCategoryDir);
  const terminal = resolveAlias(map, to);
  if (terminal === from) return;
  map[from] = terminal;
  // Re-point any existing aliases that were pointing at `from` → new terminal
  for (const [k, v] of Object.entries(map)) {
    if (v === from) map[k] = terminal;
  }
  await writeAliasMap(imagesCategoryDir, map);
}

export async function removeAlias(imagesCategoryDir: string, name: string): Promise<void> {
  const map = await readAliasMap(imagesCategoryDir);
  if (!(name in map)) return;
  delete map[name];
  await writeAliasMap(imagesCategoryDir, map);
}

/**
 * Resolve an alias and verify the target file exists in `targetDir`.
 * If the target no longer exists, the stale alias is removed and `name` is returned.
 * Used by the auto-downloaders as a self-healing lookup.
 */
export async function resolveAliasChecked(
  imagesCategoryDir: string,
  targetDir: string,
  name: string,
): Promise<string> {
  const map = await readAliasMap(imagesCategoryDir);
  const resolved = resolveAlias(map, name);
  if (resolved === name) return name;
  if (existsSync(path.join(targetDir, resolved))) return resolved;
  await removeAlias(imagesCategoryDir, name);
  return name;
}
