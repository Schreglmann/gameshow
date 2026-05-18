/**
 * Read-only sync-drift diagnostic.
 *
 * Answers the operational question raised by the Layer 2 + Layer 3 safety
 * messages on startup:
 *
 *   [startup-sync] safety: "images/" lost 13.8% of prev-state files on NAS …
 *   [startup-sync] safety: N deletions exceed safety hard cap (5) …
 *
 * For every top-level asset folder the script reports the four populations
 * that drive `computeSyncOps`:
 *
 *   prevOnly_on_NAS   = (prev ∩ local) \ nasWalk  → candidates for delete-local
 *   prevOnly_on_local = (prev ∩ nasWalk) \ local  → candidates for delete-nas
 *   untracked_local   = local \ prev              → would be push
 *   untracked_nas     = nasWalk \ prev            → would be pull
 *
 * For every `prevOnly_on_NAS` entry the script then re-stats the NAS path
 * directly (bypassing the recursive walk) and buckets the result. This is the
 * key signal: if `stat OK` dominates the missing-from-walk count, the NAS walk
 * is returning partial results (typical macOS SMB enumeration truncation). If
 * `ENOENT` dominates, the NAS really lost those files.
 *
 * A second full NAS walk runs at the end so any non-determinism in the walk
 * itself shows up as a count diff.
 *
 * Exits 0 always — read-only.
 */

import path from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { stat } from 'fs/promises';
import {
  parseSyncState,
  resolvePrevFiles,
  SAFETY_FOLDERS,
  type SyncState,
} from '../server/nas-sync.js';
import { collectFileMetadata } from '../server/nas-walk.js';
import { LOCAL_ASSETS_BASE, NAS_BASE } from '../server/asset-paths.js';

const ASSET_FOLDERS = ['audio', 'images', 'background-music', 'videos'] as const;

const STAT_CONCURRENCY = 8;

function readSyncState(baseDir: string): SyncState {
  const p = path.join(baseDir, '.sync-state.json');
  if (!existsSync(p)) return { lastSync: '', files: {} };
  return parseSyncState(readFileSync(p, 'utf8'));
}

function topFolder(rel: string): string | null {
  const i = rel.indexOf('/');
  if (i <= 0) return null;
  return rel.slice(0, i).normalize('NFC');
}

function groupByFolder(paths: Iterable<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of ASSET_FOLDERS) out.set(f, []);
  for (const p of paths) {
    const f = topFolder(p);
    if (f && out.has(f)) out.get(f)!.push(p);
  }
  return out;
}

interface RestatResult {
  ok: number;
  enoent: number;
  other: number;
  otherSamples: string[];
  okSamples: string[];
  enoentSamples: string[];
}

async function restatBatch(baseDir: string, rels: readonly string[]): Promise<RestatResult> {
  const result: RestatResult = {
    ok: 0,
    enoent: 0,
    other: 0,
    otherSamples: [],
    okSamples: [],
    enoentSamples: [],
  };
  for (let i = 0; i < rels.length; i += STAT_CONCURRENCY) {
    const slice = rels.slice(i, i + STAT_CONCURRENCY);
    const settled = await Promise.allSettled(slice.map(rel => stat(path.join(baseDir, rel))));
    for (let j = 0; j < settled.length; j++) {
      const rel = slice[j];
      const s = settled[j];
      if (s.status === 'fulfilled') {
        result.ok++;
        if (result.okSamples.length < 5) result.okSamples.push(rel);
      } else {
        const code = (s.reason as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          result.enoent++;
          if (result.enoentSamples.length < 5) result.enoentSamples.push(rel);
        } else {
          result.other++;
          if (result.otherSamples.length < 5) result.otherSamples.push(`${rel} (${code})`);
        }
      }
    }
  }
  return result;
}

function isNasMounted(): boolean {
  try { return statSync(NAS_BASE).isDirectory(); } catch { return false; }
}

function fmtPct(num: number, denom: number): string {
  if (denom === 0) return '0.0%';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  console.log('=== Sync drift diagnostic (read-only) ===\n');
  console.log(`LOCAL_ASSETS_BASE: ${LOCAL_ASSETS_BASE}`);
  console.log(`NAS_BASE:          ${NAS_BASE}`);

  if (!isNasMounted()) {
    console.error('\nNAS is not mounted — cannot run the NAS walk. Mount the share and retry.');
    process.exit(0);
  }

  const localState = readSyncState(LOCAL_ASSETS_BASE);
  const nasState = readSyncState(NAS_BASE);
  console.log(`\nlocal .sync-state.json: ${localState.lastSync || '(empty)'}  (${Object.keys(localState.files).length} entries)`);
  console.log(`NAS   .sync-state.json: ${nasState.lastSync || '(empty)'}  (${Object.keys(nasState.files).length} entries)`);

  const prevFiles = resolvePrevFiles(localState, nasState);
  const winner = localState.lastSync >= nasState.lastSync ? 'local' : 'NAS';
  console.log(`prev-state authoritative side: ${winner}  (${Object.keys(prevFiles).length} entries)\n`);

  console.log('Walking local + NAS …');
  const t0 = Date.now();
  const [localFiles, nasFiles] = await Promise.all([
    collectFileMetadata(LOCAL_ASSETS_BASE, ASSET_FOLDERS),
    collectFileMetadata(NAS_BASE, ASSET_FOLDERS),
  ]);
  console.log(`  walked in ${((Date.now() - t0) / 1000).toFixed(1)}s — local ${localFiles.size}, NAS ${nasFiles.size}\n`);

  const prevByFolder = groupByFolder(Object.keys(prevFiles));

  for (const folder of ASSET_FOLDERS) {
    const prevSet = new Set(prevByFolder.get(folder) ?? []);
    const localInFolder = new Set([...localFiles.keys()].filter(r => topFolder(r) === folder));
    const nasInFolder = new Set([...nasFiles.keys()].filter(r => topFolder(r) === folder));

    const prevOnlyOnNas: string[] = [];
    const prevOnlyOnLocal: string[] = [];
    for (const rel of prevSet) {
      const onLocal = localInFolder.has(rel);
      const onNas = nasInFolder.has(rel);
      if (onLocal && !onNas) prevOnlyOnNas.push(rel);
      if (onNas && !onLocal) prevOnlyOnLocal.push(rel);
    }
    const untrackedLocal = [...localInFolder].filter(r => !prevSet.has(r));
    const untrackedNas = [...nasInFolder].filter(r => !prevSet.has(r));

    const layer2Trigger = prevSet.size > 0
      ? Math.max(prevOnlyOnNas.length, prevOnlyOnLocal.length) / prevSet.size >= 0.05
      : false;

    console.log(`── ${folder}/  prev:${prevSet.size}  local:${localInFolder.size}  NAS:${nasInFolder.size}`);
    console.log(`     would emit:  delete-local ${prevOnlyOnNas.length}    delete-nas ${prevOnlyOnLocal.length}    push ${untrackedLocal.length}    pull ${untrackedNas.length}`);
    if (layer2Trigger) {
      const nasRatio = fmtPct(prevOnlyOnNas.length, prevSet.size);
      const localRatio = fmtPct(prevOnlyOnLocal.length, prevSet.size);
      console.log(`     Layer 2 fires:  NAS loss ${nasRatio} / local loss ${localRatio} (threshold 5%)`);
    }

    if (prevOnlyOnNas.length > 0) {
      console.log(`     re-stat ${prevOnlyOnNas.length} on NAS…`);
      const r = await restatBatch(NAS_BASE, prevOnlyOnNas);
      const verdict =
        r.ok > 0 && r.enoent === 0 ? 'walk missed every drifted file → SMB enumeration truncation'
        : r.enoent > 0 && r.ok === 0 ? 'every drifted file truly absent on NAS'
        : r.ok > 0 && r.enoent > 0 ? 'mixed — walk and NAS both lossy'
        : r.other > 0 ? 'inconclusive — see other-errno samples'
        : 'no samples';
      console.log(`       OK ${r.ok}   ENOENT ${r.enoent}   other ${r.other}   → ${verdict}`);
      if (r.okSamples.length > 0)     console.log(`       OK e.g.:     ${r.okSamples.slice(0, 3).join(' | ')}`);
      if (r.enoentSamples.length > 0) console.log(`       ENOENT e.g.: ${r.enoentSamples.slice(0, 3).join(' | ')}`);
      if (r.otherSamples.length > 0)  console.log(`       other e.g.:  ${r.otherSamples.slice(0, 3).join(' | ')}`);
    }
    if (prevOnlyOnLocal.length > 0 && prevOnlyOnLocal.length <= 20) {
      console.log(`     delete-nas candidates:`);
      for (const rel of prevOnlyOnLocal.slice(0, 20)) console.log(`       ${rel}`);
    } else if (prevOnlyOnLocal.length > 20) {
      console.log(`     delete-nas candidates (first 20 of ${prevOnlyOnLocal.length}):`);
      for (const rel of prevOnlyOnLocal.slice(0, 20)) console.log(`       ${rel}`);
    }
    console.log();
  }

  console.log('Re-walking NAS once more to check determinism…');
  const t1 = Date.now();
  const nasFiles2 = await collectFileMetadata(NAS_BASE, ASSET_FOLDERS);
  console.log(`  re-walked in ${((Date.now() - t1) / 1000).toFixed(1)}s — NAS ${nasFiles2.size} (first walk ${nasFiles.size}, diff ${Math.abs(nasFiles.size - nasFiles2.size)})`);
  if (nasFiles.size !== nasFiles2.size) {
    const onlyInFirst = [...nasFiles.keys()].filter(r => !nasFiles2.has(r));
    const onlyInSecond = [...nasFiles2.keys()].filter(r => !nasFiles.has(r));
    console.log(`  non-deterministic NAS walk → ${onlyInFirst.length} entries dropped, ${onlyInSecond.length} entries appeared`);
    if (onlyInFirst.length > 0)  console.log(`    dropped e.g.:  ${onlyInFirst.slice(0, 3).join(' | ')}`);
    if (onlyInSecond.length > 0) console.log(`    appeared e.g.: ${onlyInSecond.slice(0, 3).join(' | ')}`);
    console.log('  → strong signal of SMB enumeration truncation on macOS');
  } else {
    console.log('  NAS walk is deterministic across two runs (single sample).');
  }

  // Sanity: SAFETY_FOLDERS and ASSET_FOLDERS should describe the same set; warn if they ever
  // diverge so a future change can't silently leave a folder unprotected.
  const safetySet = new Set<string>(SAFETY_FOLDERS as readonly string[]);
  const assetSet = new Set<string>(ASSET_FOLDERS as readonly string[]);
  if (safetySet.size !== assetSet.size || [...safetySet].some(f => !assetSet.has(f))) {
    console.warn('\nWARN: SAFETY_FOLDERS ≠ ASSET_FOLDERS — Layer 2 veto and walk scope disagree.');
  }

  console.log('\nDone. No files were written.');
}

main().catch(err => {
  console.error('diagnose-sync-drift failed:', err);
  process.exit(1);
});
