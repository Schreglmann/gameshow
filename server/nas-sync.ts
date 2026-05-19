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
 *   `applyDeletionSafety` — Layer 2, strips delete ops when a folder lost ≥ 5% of its
 *                           prev-state files on one side (catches partial data loss /
 *                           mount degradation, not just the entirely-empty case)
 *   `checkBulkDelete`     — Layer 3, aborts when proposed deletes exceed a hard cap of 5
 *                           (single user actions are 1–3 files; >5 indicates corruption)
 *   `trashRel`            — Layer 1, computes the destination path under .trash/ for a soft-delete
 */

/** Top-level folders that get the per-folder empty-side veto. */
export const SAFETY_FOLDERS = ['audio', 'images', 'background-music', 'videos'] as const;
export type SafetyFolder = (typeof SAFETY_FOLDERS)[number];

/**
 * Shared filesystem-walk filter. CLI and server walks MUST apply identical
 * filters or the same `.sync-state.json` file gets populated with different
 * key sets on each side — entries that one walk includes and the other skips
 * appear "in prev + missing locally" on the next sync and trigger false
 * `delete-*` ops.
 *
 * Skipped entries:
 *   - any dotfile (`.sync-state.json`, `.video-references.json`,
 *     `.asset-aliases.json`, `.audio-cover-meta.json`, `.color-profiles.json`,
 *     `.smbdelete*`, `.smbtemp*`, `.trash`, …) — these are internal state, not
 *     game assets
 *   - files mid-transcode (`*.transcoding.*`)
 *   - the per-asset auto-LUFS `backup/` folder — original audio is overwritten
 *     with the normalized version locally and the backup is local-only by design
 */
export function shouldSkipDirent(name: string): boolean {
  if (name.startsWith('.')) return true;
  if (name.includes('.transcoding.')) return true;
  if (name === 'backup') return true;
  return false;
}

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
 * Files whose op failed are omitted from the new state so the next sync
 * retries the same push/pull instead of misinterpreting "in prev + missing
 * on one side" as a user-initiated delete. (Pre-fix: a failed push left the
 * file in the new state with local-side mtime — on the next sync the file
 * was now "in prev but missing from NAS" → false delete-local. That's how
 * the 2026-05-14 incident wiped 466 files.)
 *
 * @param localFiles Current local file metadata (pre-op scan)
 * @param nasFiles   Current NAS file metadata (pre-op scan)
 * @param ops        Sync operations that were (or will be) applied
 * @param failedOps  `rel` paths of ops that failed; their files are omitted
 *                   from the new state regardless of which side scanned them
 * @returns New SyncState to write to both sides
 */
export function buildNewSyncState(
  localFiles: Map<string, FileMeta>,
  nasFiles: Map<string, FileMeta>,
  ops: SyncOp[],
  failedOps: ReadonlySet<string> = new Set(),
): SyncState {
  const allPaths = new Set([...localFiles.keys(), ...nasFiles.keys()]);
  const deletedPaths = new Set(
    ops.filter(o => o.action === 'delete-local' || o.action === 'delete-nas').map(o => o.rel)
  );

  const files: Record<string, string> = {};
  for (const rel of allPaths) {
    if (deletedPaths.has(rel)) continue;
    if (failedOps.has(rel)) continue;
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
 *
 * All keys are normalized to Unicode NFC. SMB shares on macOS may return file
 * names in NFD (decomposed: `O + combining diaeresis`) while local-assets
 * holds them in NFC (composed: `Ö`). Without normalization, the same logical
 * file appears under different string keys on either side, and `computeSyncOps`
 * misreads the mismatch as "missing on the other side" → false `delete-*`.
 * The 2026-05-14 incident trashed dozens of files for exactly this reason.
 *
 * Normalizing on parse covers state files that were written before this fix.
 */
export function parseSyncState(json: string): SyncState {
  try {
    const parsed = JSON.parse(json) as SyncState;
    if (parsed && typeof parsed.lastSync === 'string' && typeof parsed.files === 'object') {
      return { lastSync: parsed.lastSync, files: normalizeStateFiles(parsed.files) };
    }
  } catch { /* invalid JSON */ }
  return { lastSync: '', files: {} };
}

function normalizeStateFiles(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    out[k.normalize('NFC')] = v;
  }
  return out;
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

// ── Safety: per-folder loss-ratio veto (Layer 2) ──

/**
 * Maximum acceptable loss-ratio per top-level folder per sync run. If a folder
 * has lost ≥ this fraction of its prev-state files on one side, that side is
 * treated as suspect and all corresponding `delete-*` ops for that folder are
 * stripped.
 *
 * 5% chosen empirically from the 2026-05-14 incident: NAS partially lost
 * `images/` (≈14% of prev) and `audio/` (≈0.4%, single subfolder). The old
 * "side is empty" check missed both because the top folders still had some
 * files. 5% catches large partial losses while remaining well above the 1–3
 * deletes a user typically performs at a time.
 */
export const FOLDER_LOSS_RATIO_THRESHOLD = 0.05;

/** A `delete-*` op that was stripped by `applyDeletionSafety`. */
export interface DeletionVeto {
  folder: SafetyFolder;
  side: 'local' | 'nas';
  count: number;
  /** Fraction of prev-state files for this folder that are missing on the suspect side (0..1). */
  lossRatio: number;
}

export interface DeletionSafetyResult {
  ops: SyncOp[];
  vetoes: DeletionVeto[];
}

/**
 * Layer 2 — strip delete ops in folders where one side has lost a significant
 * fraction of its prev-state files (likely partial-mount, permission glitch,
 * or external data loss).
 *
 * For each top-level folder F in `SAFETY_FOLDERS`:
 *   - Compute `nasLoss = (prev ∩ F) \ (NAS ∩ F)` — files prev tracked but NAS
 *     no longer has. If `nasLoss / |prev ∩ F| ≥ FOLDER_LOSS_RATIO_THRESHOLD`,
 *     mark F's NAS side as suspect → strip every `delete-local` op for F.
 *   - Symmetric rule for `delete-nas` using `localLoss`.
 *
 * The previous version only fired when `nasCount === 0` (entirely empty),
 * which missed every partial-loss scenario in the 2026-05-14 incident. The
 * ratio-based check catches both the "totally empty" and "lost 30 of 200
 * files" cases under one rule.
 *
 * Pure function — does not perform any I/O. Returns the filtered op list and
 * a per-folder report of what was vetoed so the caller can warn loudly.
 */
export function applyDeletionSafety(
  ops: SyncOp[],
  localFiles: Map<string, FileMeta>,
  nasFiles: Map<string, FileMeta>,
  prevFiles: Record<string, string>,
  intentBackedDeleteNasRels: ReadonlySet<string> = new Set(),
): DeletionSafetyResult {
  // Files that prev tracked but the side no longer has — i.e. apparent loss.
  // Counted per top-folder; that's the unit Layer 2 protects.
  //
  // Files in `intentBackedDeleteNasRels` are excluded from the local-loss
  // count: the DAM moved them to local `.trash/`, so the active-path walk
  // doesn't see them, but that's deliberate — not data loss. Without this
  // exclusion a legitimate ≥5% DAM bulk-delete would trip Layer 2's
  // symmetric "local suspect" branch and strip the corresponding delete-nas
  // recovery ops, leaving the NAS side stuck at the active path.
  const nasLossByFolder: Record<string, number> = {};
  const localLossByFolder: Record<string, number> = {};
  const prevCounts = countByFolder(Object.keys(prevFiles));

  for (const rel of Object.keys(prevFiles)) {
    const folder = topFolder(rel);
    if (!folder) continue;
    if (!nasFiles.has(rel)) nasLossByFolder[folder] = (nasLossByFolder[folder] ?? 0) + 1;
    if (!localFiles.has(rel) && !intentBackedDeleteNasRels.has(rel)) {
      localLossByFolder[folder] = (localLossByFolder[folder] ?? 0) + 1;
    }
  }

  const suspectRatio = new Map<string, number>(); // `${side}:${folder}` → ratio
  for (const folder of SAFETY_FOLDERS) {
    const prev = prevCounts[folder] ?? 0;
    if (prev === 0) continue;
    const nasRatio = (nasLossByFolder[folder] ?? 0) / prev;
    if (nasRatio >= FOLDER_LOSS_RATIO_THRESHOLD) {
      suspectRatio.set(`nas:${folder}`, nasRatio); // NAS lost ≥ 5% → skip delete-local
    }
    const localRatio = (localLossByFolder[folder] ?? 0) / prev;
    if (localRatio >= FOLDER_LOSS_RATIO_THRESHOLD) {
      suspectRatio.set(`local:${folder}`, localRatio); // local lost ≥ 5% → skip delete-nas
    }
  }

  if (suspectRatio.size === 0) {
    return { ops, vetoes: [] };
  }

  const vetoes = new Map<string, DeletionVeto>();
  const filtered: SyncOp[] = [];
  for (const op of ops) {
    const folder = topFolder(op.rel);
    if (op.action === 'delete-local' && folder && suspectRatio.has(`nas:${folder}`)) {
      bumpVeto(vetoes, folder, 'local', suspectRatio.get(`nas:${folder}`)!);
      continue;
    }
    if (op.action === 'delete-nas' && folder && suspectRatio.has(`local:${folder}`)) {
      bumpVeto(vetoes, folder, 'nas', suspectRatio.get(`local:${folder}`)!);
      continue;
    }
    filtered.push(op);
  }

  return { ops: filtered, vetoes: Array.from(vetoes.values()) };
}

function topFolder(rel: string): SafetyFolder | null {
  // Accept either separator — paths on this codebase are POSIX (`/`) but a
  // stray Windows-style rel mustn't crash the safety check. Don't pick by
  // first-found because a path like `images/foo\bar.jpg` would mis-split.
  const slashIdx = rel.indexOf('/');
  const backslashIdx = rel.indexOf('\\');
  const i = slashIdx < 0 ? backslashIdx
          : backslashIdx < 0 ? slashIdx
          : Math.min(slashIdx, backslashIdx);
  if (i <= 0) return null;
  const head = rel.slice(0, i).normalize('NFC');
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

function bumpVeto(
  out: Map<string, DeletionVeto>,
  folder: SafetyFolder,
  side: 'local' | 'nas',
  lossRatio: number,
): void {
  const key = `${side}:${folder}`;
  const existing = out.get(key);
  if (existing) existing.count++;
  else out.set(key, { folder, side, count: 1, lossRatio });
}

// ── Safety: bulk-delete cap (Layer 3) ──

/**
 * Hard cap on the number of `delete-*` ops a single sync run may execute.
 *
 * Set to 5 after the 2026-05-14 incident. User-initiated deletions go through
 * the admin DAM (`queueNasDelete` / `queueNasMove`) — those don't pass through
 * `computeSyncOps`, so they don't count toward this cap. The auto-delete path
 * (file missing on one side + in prev) is only legitimate for the rare
 * external-delete or post-restart-queue-recovery case, which is always 1–3
 * files. >5 indicates NAS data loss, a failed-op state-snapshot artifact, or
 * another bug — never a real user action.
 *
 * The previous cap of `max(50, 5% of total tracked)` admitted up to 1400
 * deletes for a 28k-file library and let two consecutive runs trash 466
 * files. A flat hard cap is much harder to reason around.
 */
export const BULK_DELETE_HARD_CAP = 5;

export interface BulkDeleteCheck {
  ok: boolean;
  totalDeletes: number;
  trackedFiles: number;
  threshold: number;
  reason?: string;
}

/**
 * Layer 3 — abort the entire sync if proposed deletions exceed `BULK_DELETE_HARD_CAP`.
 *
 * `intentBackedDeleteNasRels` is the set of `delete-nas` rel paths that are
 * backed by direct evidence of user intent (a copy of the file under local
 * `<base>/<cat>/.trash/<batchId>/<rel>`). Those ops are recovery from a
 * failed DAM `move-to-trash` queue op and explicitly should not count toward
 * the cap — Layer 3 was tuned assuming "all real user deletes bypass
 * `computeSyncOps`", which is only true when the NAS-side queue op succeeds
 * on the first try. EBUSY oplocks, NAS-unmounted-at-enqueue races, and
 * transient SMB hiccups push the recovery into this code path. Trash-backed
 * `delete-nas` ops are still executed; they simply don't count toward the
 * cap and won't abort the run.
 *
 * `delete-local` always counts (the only legitimate cause is NAS data loss
 * which is exactly what the cap protects against). Orphan `delete-nas`
 * (rel not in the intent set) also counts.
 *
 * Pure function — caller decides what to do (CLI exits with --force-bulk-delete
 * override; server aborts and surfaces an admin-visible error).
 */
export function checkBulkDelete(
  ops: SyncOp[],
  localFiles: Map<string, FileMeta>,
  nasFiles: Map<string, FileMeta>,
  intentBackedDeleteNasRels: ReadonlySet<string> = new Set(),
): BulkDeleteCheck {
  const totalDeletes = ops.reduce((n, o) => {
    if (o.action === 'delete-local') return n + 1;
    if (o.action === 'delete-nas' && !intentBackedDeleteNasRels.has(o.rel)) return n + 1;
    return n;
  }, 0);
  const trackedFiles = localFiles.size + nasFiles.size;
  const threshold = BULK_DELETE_HARD_CAP;

  if (totalDeletes <= threshold) {
    return { ok: true, totalDeletes, trackedFiles, threshold };
  }

  return {
    ok: false,
    totalDeletes,
    trackedFiles,
    threshold,
    reason:
      `${totalDeletes} deletions exceed safety hard cap (${threshold}). ` +
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

/** Filesystem-safe ISO timestamp suitable for `runId`.
 *  Appends a 4-char random suffix so two sync runs that start in the same
 *  millisecond (startupSync + periodicRescan overlap, or the queue retry
 *  interval firing during a manual `npm run sync`) get distinct trash dirs.
 *  Without the suffix they'd interleave files into one folder and a `.1/.2`
 *  collision-suffix chain would mask which run trashed what — important for
 *  forensics on the next data-loss incident. */
export function makeRunId(now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[:.]/g, '-');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${ts}-${suffix}`;
}
