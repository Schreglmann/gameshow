/**
 * NAS move-intent ledger — records DAM folder/file moves whose NAS-side rename
 * has not yet been confirmed, so the bidirectional sync can (1) recognize an
 * old→new folder divergence as an in-flight *move* rather than data loss, and
 * (2) drive a cheap NAS rename to finish the move instead of re-uploading the
 * whole folder.
 *
 * WHY THIS EXISTS. A DAM move renames the folder locally (synchronously) and
 * enqueues ONE NAS `move` op. On the happy path that op renames the folder on
 * the NAS and `applyOpToSyncSnapshot` prefix-remaps `.sync-state.json` — no
 * divergence, the failsafe stays quiet. But the op is dropped without updating
 * the snapshot when the NAS is offline at enqueue (`queueNasSync` early-returns)
 * or the op throws (EBUSY / SMB rename glitch). Then local = new folder, NAS =
 * old folder, snapshot = old folder, and the next rescan reads every old-path
 * file as `delete-nas` + every new-path file as `push` — for >5 files Layer 3
 * aborts, for ≥5% Layer 2 vetoes. This ledger closes exactly that gap, the same
 * way the trash-intent set (`collectTrashedRelPaths`) closed it for bulk deletes.
 * See specs/sync-bidirectional.md "Move-intent override".
 *
 * SAFETY INVARIANT. The ledger is only a *claim* — a written assertion that can
 * go stale. It must never on its own exclude a `delete-nas` from the failsafe.
 * `computeMovedAwayRels` excludes a `delete-nas` ONLY when the destination file
 * physically exists locally under `relTo` (per file). That local file is the
 * proof the content is not lost — the exact moral equivalent of "the file
 * physically sits in `.trash/`" for the delete case. The paranoid consequence:
 * a genuine deletion can never be masked for the *moved* files themselves; only
 * ≤5 co-located non-intent losses in the same window can slip past Layer 2, and
 * those still count toward Layer 3 and are soft-deleted (recoverable) — the same
 * residual risk the trash-intent exclusion already accepts.
 *
 * Stored as a dotfile at the assets-tree root (`<base>/.nas-sync-moves.json`),
 * next to `.sync-state.json` / `.nas-sync-conflicts.json` and OUTSIDE the walked
 * category folders, so it never affects the sync itself. Mirrors the atomic
 * read/write + validate-on-read pattern of `server/nas-sync-conflicts.ts`.
 */

import path from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';

export interface PendingMove {
  /** Source folder/file path relative to the assets base (map key), e.g. `images/Logos/Alt`. */
  relFrom: string;
  /** Destination path relative to the assets base, e.g. `images/Logos/Neu`. */
  relTo: string;
  /** First time this move was recorded (epoch ms) — drives TTL expiry. */
  detectedAt: number;
  /** Most recent sync run that still saw this move unresolved (epoch ms). */
  lastSeenAt: number;
}

export type PendingMoveMap = Record<string, PendingMove>;

export function nasSyncMovesPath(base: string): string {
  return path.join(base, '.nas-sync-moves.json');
}

function isValidEntry(value: unknown): value is PendingMove {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.relFrom !== 'string' || !v.relFrom) return false;
  if (typeof v.relTo !== 'string' || !v.relTo) return false;
  if (typeof v.detectedAt !== 'number') return false;
  if (typeof v.lastSeenAt !== 'number') return false;
  return true;
}

export async function readPendingMoves(base: string): Promise<PendingMoveMap> {
  const file = nasSyncMovesPath(base);
  if (!existsSync(file)) return {};
  try {
    const raw = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: PendingMoveMap = {};
    for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidEntry(val)) out[k] = val;
    }
    return out;
  } catch {
    return {};
  }
}

/** Atomic tmp + rename write. Absent directory is created first. */
export async function savePendingMoves(base: string, map: PendingMoveMap): Promise<void> {
  const file = nasSyncMovesPath(base);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/**
 * Record a folder/file move whose NAS-side rename is not yet confirmed.
 *
 * Paths are NFC-normalized so the ledger keys match the NFC keys every
 * filesystem walk and `computeSyncOps` produce (the 2026-05-14 NFC-mismatch
 * lesson). Idempotent per `relFrom`.
 *
 * Linear chain-collapse: if this move continues an existing one (its `relFrom`
 * equals a recorded entry's `relTo` — i.e. the same folder was moved A→B then
 * B→C before the first move resolved), rewrite that entry's `relTo` in place
 * (A→C) instead of adding a second entry. This is required for correctness, not
 * just tidiness: after the second local rename there are no local files under B,
 * so a separate {A→B}+{B→C} pair would leave the real `delete-nas A/x` (NAS
 * still holds A) uncovered by `computeMovedAwayRels` and the failsafe would
 * trip. Collapsing to {A→C} keeps `relTo` pointing at current local reality.
 * Non-linear/nested re-moves are not collapsed and degrade to the failsafe
 * firing (safe) — see the spec.
 */
export async function recordPendingMove(
  base: string,
  relFrom: string,
  relTo: string,
  now: number,
): Promise<void> {
  const from = relFrom.normalize('NFC');
  const to = relTo.normalize('NFC');
  if (!from || !to || from === to) return;
  const map = await readPendingMoves(base);

  // Chain-collapse: find an entry whose destination is exactly this move's source.
  const chainKey = Object.keys(map).find((k) => map[k]!.relTo === from);
  if (chainKey) {
    const existing = map[chainKey]!;
    map[chainKey] = { ...existing, relTo: to, lastSeenAt: now };
  } else {
    const existing = map[from];
    map[from] = { relFrom: from, relTo: to, detectedAt: existing?.detectedAt ?? now, lastSeenAt: now };
  }
  await savePendingMoves(base, map);
}

/** Remove a single move record once its NAS rename is confirmed. Missing key is a no-op. */
export async function clearPendingMove(base: string, relFrom: string): Promise<void> {
  const key = relFrom.normalize('NFC');
  const map = await readPendingMoves(base);
  if (!(key in map)) return;
  delete map[key];
  await savePendingMoves(base, map);
}

/** Count of currently-recorded pending moves. */
export async function countPendingMoves(base: string): Promise<number> {
  return Object.keys(await readPendingMoves(base)).length;
}

/**
 * Split a stale-vs-live ledger by TTL. A move that a healthy NAS reconnect
 * cannot resolve within the TTL is genuinely stuck (usually "NAS already has
 * both source and destination"); expiring it hands control back to the failsafe
 * (the safe bias) and keeps the Layer-2 dilution window short. Pure — the caller
 * persists `kept` and logs `expired`.
 */
export function expirePendingMoves(
  map: PendingMoveMap,
  now: number,
  maxAgeMs: number,
): { kept: PendingMoveMap; expired: PendingMove[] } {
  const kept: PendingMoveMap = {};
  const expired: PendingMove[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (now - v.detectedAt >= maxAgeMs) expired.push(v);
    else kept[k] = v;
  }
  return { kept, expired };
}

/**
 * The set of `delete-nas` rels that are moved-away files, safe to exclude from
 * the Layer 2 loss-ratio and Layer 3 bulk-cap accounting.
 *
 * A `delete-nas` rel qualifies ONLY when both hold:
 *   1. it falls under a recorded move's `relFrom` (it equals `relFrom`, or sits
 *      under `relFrom + sep`), AND
 *   2. the corresponding destination path under `relTo` physically exists in
 *      `localFileKeys`.
 *
 * Guard (2) is the safety invariant: it proves the content still exists on local
 * disk, so propagating the `delete-nas` (soft-delete of the stale NAS copy) can
 * never be data loss. Pure + unit-testable — mirrors `computeSyncOps`.
 */
export function computeMovedAwayRels(
  moves: readonly PendingMove[],
  localFileKeys: Iterable<string>,
  deleteNasRels: ReadonlySet<string>,
  sep = '/',
): Set<string> {
  const out = new Set<string>();
  if (moves.length === 0 || deleteNasRels.size === 0) return out;
  const localKeys = localFileKeys instanceof Set ? localFileKeys : new Set(localFileKeys);
  for (const rel of deleteNasRels) {
    for (const mv of moves) {
      let suffix: string | null = null;
      if (rel === mv.relFrom) suffix = '';
      else if (rel.startsWith(mv.relFrom + sep)) suffix = rel.slice(mv.relFrom.length);
      if (suffix === null) continue;
      if (localKeys.has(mv.relTo + suffix)) { out.add(rel); break; }
    }
  }
  return out;
}
