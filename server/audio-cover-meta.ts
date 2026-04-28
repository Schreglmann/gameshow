/**
 * Audio cover metadata sidecar — records the provenance of each audio cover
 * so the DAM can display a "Quelle" pill (YouTube / iTunes / MusicBrainz /
 * Manuell / Automatisch) and so override operations can overwrite prior
 * auto-fetched covers.
 *
 * Stored as a dotfile inside the images category so it's excluded from DAM
 * listings by the existing `e.name.startsWith('.')` filter — mirrors
 * `.asset-aliases.json`.
 *
 * Keyed by the cover filename (e.g. `{audioBasename}.jpg`). Values are
 * plain JSON objects; no chaining, no normalisation beyond what the caller
 * writes.
 */

import path from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';

export type AudioCoverSource = 'youtube' | 'itunes' | 'musicbrainz' | 'manual' | 'auto';

export interface AudioCoverMetaEntry {
  source: AudioCoverSource;
  setAt: number;
  origin?: { pickedFrom?: string };
}

export type AudioCoverMeta = Record<string, AudioCoverMetaEntry>;

const VALID_SOURCES: AudioCoverSource[] = ['youtube', 'itunes', 'musicbrainz', 'manual', 'auto'];

export function audioCoverMetaPath(imagesCategoryDir: string): string {
  return path.join(imagesCategoryDir, '.audio-cover-meta.json');
}

function isValidEntry(value: unknown): value is AudioCoverMetaEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.source !== 'string' || !VALID_SOURCES.includes(v.source as AudioCoverSource)) return false;
  if (typeof v.setAt !== 'number') return false;
  if (v.origin !== undefined) {
    if (!v.origin || typeof v.origin !== 'object') return false;
    const o = v.origin as Record<string, unknown>;
    if (o.pickedFrom !== undefined && typeof o.pickedFrom !== 'string') return false;
  }
  return true;
}

export async function readAudioCoverMeta(imagesCategoryDir: string): Promise<AudioCoverMeta> {
  const file = audioCoverMetaPath(imagesCategoryDir);
  if (!existsSync(file)) return {};
  try {
    const raw = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: AudioCoverMeta = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidEntry(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeAudioCoverMeta(imagesCategoryDir: string, map: AudioCoverMeta): Promise<void> {
  const file = audioCoverMetaPath(imagesCategoryDir);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

export async function setAudioCoverMeta(
  imagesCategoryDir: string,
  coverFilename: string,
  entry: AudioCoverMetaEntry,
): Promise<void> {
  if (!coverFilename) return;
  const map = await readAudioCoverMeta(imagesCategoryDir);
  map[coverFilename] = entry;
  await writeAudioCoverMeta(imagesCategoryDir, map);
}

export async function deleteAudioCoverMeta(
  imagesCategoryDir: string,
  coverFilename: string,
): Promise<void> {
  if (!coverFilename) return;
  const map = await readAudioCoverMeta(imagesCategoryDir);
  if (!(coverFilename in map)) return;
  delete map[coverFilename];
  await writeAudioCoverMeta(imagesCategoryDir, map);
}

export async function renameAudioCoverMeta(
  imagesCategoryDir: string,
  oldCoverFilename: string,
  newCoverFilename: string,
): Promise<void> {
  if (!oldCoverFilename || !newCoverFilename || oldCoverFilename === newCoverFilename) return;
  const map = await readAudioCoverMeta(imagesCategoryDir);
  const entry = map[oldCoverFilename];
  if (!entry) return;
  delete map[oldCoverFilename];
  map[newCoverFilename] = entry;
  await writeAudioCoverMeta(imagesCategoryDir, map);
}
