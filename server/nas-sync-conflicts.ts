/**
 * NAS sync conflict sidecar — records the deletions the sync's safety layers
 * *refuse* to perform (Layer 2 loss-ratio veto, Layer 3 bulk-delete cap) so the
 * admin System tab can list them and the operator can resolve each one instead
 * of the same warning recurring on every boot + 5-minute rescan.
 *
 * Stored as a dotfile at the assets-tree root (`<base>/.nas-sync-conflicts.json`),
 * next to `.sync-state.json` and OUTSIDE the walked category folders, so it never
 * affects the sync itself. Mirrors the atomic read/write pattern of
 * `server/audio-cover-meta.ts` / `server/asset-alias-map.ts`.
 *
 * Keyed by the file's relative path (e.g. `images/Tiere/Fuchs.jpg`). Values are
 * validated on read; malformed entries are dropped. See specs/nas-sync-conflicts.md.
 */

import path from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';

export type NasSyncConflictReason = 'loss-ratio-veto' | 'bulk-cap';
export type NasSyncConflictAction = 'delete-local' | 'delete-nas';

export interface NasSyncConflictEntry {
  /** File path relative to the assets base, e.g. `images/Tiere/Fuchs.jpg` (map key). */
  rel: string;
  /** The refused op. presentSide is derived: delete-local → local, delete-nas → nas. */
  action: NasSyncConflictAction;
  /** Top-level safety folder (audio / images / background-music / videos). */
  folder: string;
  /** Which safety layer refused the deletion. */
  reason: NasSyncConflictReason;
  /** Fraction of prev-state files lost on the suspect side (0..1); loss-ratio-veto only. */
  lossRatio?: number;
  /** The sync run that last refused this deletion. */
  runId: string;
  /** First time this conflict was seen (epoch ms) — preserved across rescans. */
  detectedAt: number;
  /** Most recent rescan that still refused this deletion (epoch ms). */
  lastSeenAt: number;
}

export type NasSyncConflictMap = Record<string, NasSyncConflictEntry>;

/**
 * A conflict as freshly detected by a sync run — the durable `detectedAt` /
 * `lastSeenAt` fields are assigned by `reconcileConflicts`.
 */
export type DetectedConflict = Omit<NasSyncConflictEntry, 'detectedAt' | 'lastSeenAt'>;

const VALID_REASONS: NasSyncConflictReason[] = ['loss-ratio-veto', 'bulk-cap'];
const VALID_ACTIONS: NasSyncConflictAction[] = ['delete-local', 'delete-nas'];

export function nasSyncConflictsPath(base: string): string {
  return path.join(base, '.nas-sync-conflicts.json');
}

function isValidEntry(value: unknown): value is NasSyncConflictEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.rel !== 'string' || !v.rel) return false;
  if (typeof v.action !== 'string' || !VALID_ACTIONS.includes(v.action as NasSyncConflictAction)) return false;
  if (typeof v.folder !== 'string') return false;
  if (typeof v.reason !== 'string' || !VALID_REASONS.includes(v.reason as NasSyncConflictReason)) return false;
  if (v.lossRatio !== undefined && typeof v.lossRatio !== 'number') return false;
  if (typeof v.runId !== 'string') return false;
  if (typeof v.detectedAt !== 'number') return false;
  if (typeof v.lastSeenAt !== 'number') return false;
  return true;
}

export async function readNasSyncConflicts(base: string): Promise<NasSyncConflictMap> {
  const file = nasSyncConflictsPath(base);
  if (!existsSync(file)) return {};
  try {
    const raw = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: NasSyncConflictMap = {};
    for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidEntry(val)) out[k] = val;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeNasSyncConflicts(base: string, map: NasSyncConflictMap): Promise<void> {
  const file = nasSyncConflictsPath(base);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/**
 * Reconcile the sidecar to the deletions refused by THIS sync run.
 *
 * Self-healing by construction: the new map is built only from `detected`, so a
 * rel that is no longer refused (drift healed externally) is dropped. An existing
 * rel keeps its original `detectedAt` and refreshes `lastSeenAt` / `runId` /
 * `reason` / `lossRatio` to the current run's values.
 *
 * Returns the reconciled entries as an array (for the in-memory count).
 */
export async function reconcileNasSyncConflicts(
  base: string,
  detected: DetectedConflict[],
  now: number,
): Promise<NasSyncConflictEntry[]> {
  const prev = await readNasSyncConflicts(base);
  const next: NasSyncConflictMap = {};
  for (const d of detected) {
    const existing = prev[d.rel];
    next[d.rel] = { ...d, detectedAt: existing?.detectedAt ?? now, lastSeenAt: now };
  }
  await writeNasSyncConflicts(base, next);
  return Object.values(next);
}

export async function getNasSyncConflict(base: string, rel: string): Promise<NasSyncConflictEntry | null> {
  const map = await readNasSyncConflicts(base);
  return map[rel] ?? null;
}

/** Remove a single conflict record (after it is resolved). Missing rel is a no-op. */
export async function removeNasSyncConflict(base: string, rel: string): Promise<void> {
  const map = await readNasSyncConflicts(base);
  if (!(rel in map)) return;
  delete map[rel];
  await writeNasSyncConflicts(base, map);
}

/** Count of currently-recorded conflicts — used to seed the in-memory counter at boot. */
export async function countNasSyncConflicts(base: string): Promise<number> {
  return Object.keys(await readNasSyncConflicts(base)).length;
}
