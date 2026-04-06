/**
 * NAS sync algorithm — pure functions for bidirectional file synchronization.
 *
 * The core sync logic compares local and NAS file states against a previous
 * sync snapshot (.sync-state.json) to determine which operations to perform:
 * - Files on both sides with different sizes → copy newer (by mtime)
 * - Files on one side only + known in previous state → deleted on other side → propagate deletion
 * - Files on one side only + NOT in previous state → new file → copy to other side
 */

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
