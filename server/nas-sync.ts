/**
 * NAS sync algorithm — pure functions for bidirectional file synchronization.
 *
 * The core sync logic compares local and NAS file states against a previous
 * sync snapshot (.sync-state.json) to determine which operations to perform:
 * - Files on both sides with different sizes → copy newer (by mtime)
 * - Files on one side only + known in previous state → deleted on other side → propagate deletion
 * - Files on one side only + NOT in previous state → new file → copy to other side
 *
 * Safety layers (see specs/sync-bidirectional.md "Safety guarantees"):
 *   `applyDeletionSafety` — Layer 2, strips delete ops when a folder appears empty on one side
 *   `checkBulkDelete`     — Layer 3, aborts when proposed deletes exceed a threshold
 *   `trashRel`            — Layer 1, computes the destination path under .trash/ for a soft-delete
 */

/** Top-level folders that get the per-folder empty-side veto. */
export const SAFETY_FOLDERS = ['audio', 'images', 'background-music', 'videos'] as const;
export type SafetyFolder = (typeof SAFETY_FOLDERS)[number];

export interface SyncState {
  lastSync: string;
  files: Record<string, string>; // relative path → ISO mtime
}

export interface FileMeta {
  mtime: Date;
  size: number;
}

export type SyncAction = 'push' | 'pull' | 'delete-local' | 'delete-nas';

export interface SyncOp {
  action: SyncAction;
  rel: string;
}

/**
 * Compute the set of sync operations needed to bring local and NAS into agreement.
 *
 * @param localFiles  Map of relative paths → file metadata on local disk
 * @param nasFiles    Map of relative paths → file metadata on NAS
 * @param prevFiles   Record of relative paths → mtime strings from the last sync state
 *                    (used to distinguish "new file" from "deleted on other side")
 * @returns Array of sync operations to perform
 */
export function computeSyncOps(
  localFiles: Map<string, FileMeta>,
  nasFiles: Map<string, FileMeta>,
  prevFiles: Record<string, string>,
): SyncOp[] {
  const allPaths = new Set([...localFiles.keys(), ...nasFiles.keys()]);
  const ops: SyncOp[] = [];

  for (const rel of allPaths) {
    const inPrev = Object.prototype.hasOwnProperty.call(prevFiles, rel);
    const localMeta = localFiles.get(rel);
    const nasMeta = nasFiles.get(rel);

    if (localMeta && nasMeta) {
      if (localMeta.size === nasMeta.size) continue; // in sync
      if (localMeta.mtime > nasMeta.mtime) {
        ops.push({ action: 'push', rel });
      } else {
        ops.push({ action: 'pull', rel });
      }
    } else if (localMeta && !nasMeta) {
      if (inPrev) {
        ops.push({ action: 'delete-local', rel }); // deleted from NAS by another machine
      } else {
        ops.push({ action: 'push', rel }); // new local file
      }
    } else if (!localMeta && nasMeta) {
      if (inPrev) {
        ops.push({ action: 'delete-nas', rel }); // deleted locally
      } else {
        ops.push({ action: 'pull', rel }); // new from another machine
      }
    }
  }

  return ops;
}

/**
 * Build the new sync state after applying operations.
 *
 * @param allPaths   Set of all file paths from both sides
 * @param localFiles Current local file metadata
 * @param nasFiles   Current NAS file metadata
 * @param ops        Sync operations that were (or will be) applied
 * @returns New SyncState to write to both sides
 */
export function buildNewSyncState(
  localFiles: Map<string, FileMeta>,
  nasFiles: Map<string, FileMeta>,
  ops: SyncOp[],
): SyncState {
  const allPaths = new Set([...localFiles.keys(), ...nasFiles.keys()]);
  const deletedPaths = new Set(
    ops.filter(o => o.action === 'delete-local' || o.action === 'delete-nas').map(o => o.rel)
  );

  const files: Record<string, string> = {};
  for (const rel of allPaths) {
    if (deletedPaths.has(rel)) continue;
    const localMeta = localFiles.get(rel);
    const nasMeta = nasFiles.get(rel);
    if (localMeta) files[rel] = localMeta.mtime.toISOString();
    else if (nasMeta) files[rel] = nasMeta.mtime.toISOString();
  }

  return { lastSync: new Date().toISOString(), files };
}

/**
 * Choose the authoritative previous-files record from two sync states.
 * Uses the more recent lastSync timestamp.
 */
export function resolvePrevFiles(localState: SyncState, nasState: SyncState): Record<string, string> {
  return localState.lastSync >= nasState.lastSync ? localState.files : nasState.files;
}

/**
 * Parse a sync state JSON string, returning a default empty state on failure.
 */
export function parseSyncState(json: string): SyncState {
  try {
    const parsed = JSON.parse(json) as SyncState;
    if (parsed && typeof parsed.lastSync === 'string' && typeof parsed.files === 'object') {
      return parsed;
    }
  } catch { /* invalid JSON */ }
  return { lastSync: '', files: {} };
}

/**
 * Per-op sync-state snapshot mutations, applied only after the matching NAS op
 * on the queue has succeeded. Keeps `.sync-state.json` consistent with NAS
 * reality so a dropped/failed op leaves prev-files pointing at the last known
 * in-sync state, which `computeSyncOps` can recover from on the next sync.
 *
 * Separator note: paths use the OS separator (matches `path.relative`
 * output everywhere in the server). Callers build `rel`/`relFrom`/`relTo`
 * via `path.join`, so we use `sep` here too. No mixing between platforms.
 */
export type SnapshotOp =
  | { type: 'upsert'; rel: string; mtime: Date }
  | { type: 'delete'; rel: string }
  | { type: 'move'; relFrom: string; relTo: string };

export function applySnapshotOp(snap: SyncState, op: SnapshotOp, sep = '/'): void {
  switch (op.type) {
    case 'upsert':
      snap.files[op.rel] = op.mtime.toISOString();
      return;
    case 'delete': {
      delete snap.files[op.rel];
      const prefix = op.rel + sep;
      for (const key of Object.keys(snap.files)) {
        if (key.startsWith(prefix)) delete snap.files[key];
      }
      return;
    }
    case 'move': {
      const entry = snap.files[op.relFrom];
      if (entry !== undefined) {
        snap.files[op.relTo] = entry;
        delete snap.files[op.relFrom];
      }
      const fromPrefix = op.relFrom + sep;
      const toPrefix = op.relTo + sep;
      for (const key of Object.keys(snap.files)) {
        if (key.startsWith(fromPrefix)) {
          snap.files[toPrefix + key.slice(fromPrefix.length)] = snap.files[key];
          delete snap.files[key];
        }
      }
      return;
    }
  }
}

// ── Safety: per-folder empty-side veto (Layer 2) ──

/** A `delete-*` op that was stripped by `applyDeletionSafety`. */
export interface DeletionVeto {
  folder: SafetyFolder;
  side: 'local' | 'nas';
  count: number;
}

export interface DeletionSafetyResult {
  ops: SyncOp[];
  vetoes: DeletionVeto[];
}

/**
 * Layer 2 — strip delete ops in folders that look mount-broken.
 *
 * For each top-level folder F in `SAFETY_FOLDERS`:
 *   - If `prevFiles` had ≥ 1 entry under F AND the NAS scan returned ZERO files
 *     under F AND local still has ≥ 1 file under F → strip every `delete-local`
 *     op for F. Most likely the NAS is degraded (wrong mount, empty share, etc.)
 *     and the deletes do not reflect a real user intent.
 *   - Symmetric rule for `delete-nas`.
 *
 * Pure function — does not perform any I/O. Returns the filtered op list and
 * a per-folder report of what was vetoed so the caller can warn loudly.
 */
export function applyDeletionSafety(
  ops: SyncOp[],
  localFiles: Map<string, FileMeta>,
  nasFiles: Map<string, FileMeta>,
  prevFiles: Record<string, string>,
): DeletionSafetyResult {
  const localCounts = countByFolder(localFiles.keys());
  const nasCounts = countByFolder(nasFiles.keys());
  const prevCounts = countByFolder(Object.keys(prevFiles));

  const localSuspect = new Set<SafetyFolder>();
  const nasSuspect = new Set<SafetyFolder>();
  for (const folder of SAFETY_FOLDERS) {
    if ((prevCounts[folder] ?? 0) > 0 && (nasCounts[folder] ?? 0) === 0 && (localCounts[folder] ?? 0) > 0) {
      nasSuspect.add(folder); // NAS-side scan is suspect → skip delete-local
    }
    if ((prevCounts[folder] ?? 0) > 0 && (localCounts[folder] ?? 0) === 0 && (nasCounts[folder] ?? 0) > 0) {
      localSuspect.add(folder); // local-side scan is suspect → skip delete-nas
    }
  }

  if (localSuspect.size === 0 && nasSuspect.size === 0) {
    return { ops, vetoes: [] };
  }

  const vetoes = new Map<string, DeletionVeto>();
  const filtered: SyncOp[] = [];
  for (const op of ops) {
    const folder = topFolder(op.rel);
    if (op.action === 'delete-local' && folder && nasSuspect.has(folder)) {
      bumpVeto(vetoes, folder, 'local');
      continue;
    }
    if (op.action === 'delete-nas' && folder && localSuspect.has(folder)) {
      bumpVeto(vetoes, folder, 'nas');
      continue;
    }
    filtered.push(op);
  }

  return { ops: filtered, vetoes: Array.from(vetoes.values()) };
}

function topFolder(rel: string): SafetyFolder | null {
  const sep = rel.indexOf('/') >= 0 ? '/' : '\\';
  const i = rel.indexOf(sep);
  if (i <= 0) return null;
  const head = rel.slice(0, i);
  return (SAFETY_FOLDERS as readonly string[]).includes(head) ? (head as SafetyFolder) : null;
}

function countByFolder(paths: Iterable<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of paths) {
    const folder = topFolder(p);
    if (!folder) continue;
    counts[folder] = (counts[folder] ?? 0) + 1;
  }
  return counts;
}

function bumpVeto(out: Map<string, DeletionVeto>, folder: SafetyFolder, side: 'local' | 'nas'): void {
  const key = `${side}:${folder}`;
  const existing = out.get(key);
  if (existing) existing.count++;
  else out.set(key, { folder, side, count: 1 });
}

// ── Safety: bulk-delete cap (Layer 3) ──

export interface BulkDeleteCheck {
  ok: boolean;
  totalDeletes: number;
  trackedFiles: number;
  threshold: number;
  reason?: string;
}

/**
 * Layer 3 — abort the entire sync if proposed deletions exceed
 * `max(50, 5% of (local + NAS) tracked files)`.
 *
 * Pure function — caller decides what to do (CLI exits with --force-bulk-delete
 * override; server aborts and surfaces an admin-visible error).
 */
export function checkBulkDelete(
  ops: SyncOp[],
  localFiles: Map<string, FileMeta>,
  nasFiles: Map<string, FileMeta>,
): BulkDeleteCheck {
  const totalDeletes = ops.reduce(
    (n, o) => (o.action === 'delete-local' || o.action === 'delete-nas' ? n + 1 : n),
    0,
  );
  const trackedFiles = localFiles.size + nasFiles.size;
  const threshold = Math.max(50, Math.ceil(trackedFiles * 0.05));

  if (totalDeletes <= threshold) {
    return { ok: true, totalDeletes, trackedFiles, threshold };
  }

  return {
    ok: false,
    totalDeletes,
    trackedFiles,
    threshold,
    reason:
      `${totalDeletes} deletions exceed safety threshold (${threshold}). ` +
      `Refusing to run — verify NAS state and re-run with --force-bulk-delete to override.`,
  };
}

// ── Safety: soft-delete trash path (Layer 1) ──

/**
 * Compute the destination path under `.trash/<runId>/` for a soft-delete.
 * Pure helper — the actual file move happens at the call site (see
 * server/sync-safety.ts and the `softDelete` helper in sync-assets.ts).
 *
 * `runId` should be a filesystem-safe ISO timestamp (no colons), e.g.
 *   `new Date().toISOString().replace(/[:.]/g, '-')`.
 */
export function trashRel(rel: string, runId: string): string {
  return `.trash/${runId}/${rel}`;
}

/** Filesystem-safe ISO timestamp suitable for `runId`. */
export function makeRunId(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-');
}
