#!/usr/bin/env node
// Diagnostic: reproduce the sync's computeSyncOps + Layer 2 + Layer 3 against
// the current state of local-assets + NAS, and print every delete op that
// would survive Layer 2. Lets us see exactly which files Layer 3 is blocking.
const fs = require('fs');
const path = require('path');

const NAS_BASE = '/Volumes/Georg/Gameshow/Assets';
const LOCAL_BASE = path.join(__dirname, '..', 'local-assets');
const FOLDERS = ['audio', 'images', 'background-music', 'videos'];
const FOLDER_LOSS_RATIO_THRESHOLD = 0.05;

function readSyncState(baseDir) {
  const p = path.join(baseDir, '.sync-state.json');
  if (!fs.existsSync(p)) return { lastSync: '', files: {} };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { lastSync: '', files: {} }; }
}

function walkFiles(baseDir, folder) {
  const results = [];
  const root = path.join(baseDir, folder);
  if (!fs.existsSync(root)) return results;
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.smbdelete') || entry.name.startsWith('.smbtemp')) continue;
      if (entry.name === '.trash') continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name.includes('.transcoding.') || entry.name === 'backup') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) results.push(path.relative(baseDir, full).normalize('NFC'));
    }
  }
  walk(root);
  return results;
}

function collectFiles(baseDir) {
  const out = new Map();
  for (const folder of FOLDERS) {
    for (const rel of walkFiles(baseDir, folder)) {
      try {
        const st = fs.statSync(path.join(baseDir, rel));
        out.set(rel, { mtime: st.mtime, size: st.size });
      } catch { /* skip */ }
    }
  }
  return out;
}

function topFolder(rel) {
  const i = rel.indexOf('/');
  if (i <= 0) return null;
  const head = rel.slice(0, i);
  return FOLDERS.includes(head) ? head : null;
}

function computeSyncOps(local, nas, prev) {
  const ops = [];
  const all = new Set([...local.keys(), ...nas.keys()]);
  for (const rel of all) {
    const inPrev = Object.prototype.hasOwnProperty.call(prev, rel);
    const lm = local.get(rel);
    const nm = nas.get(rel);
    if (lm && nm) {
      if (lm.size === nm.size) continue;
      ops.push({ action: lm.mtime > nm.mtime ? 'push' : 'pull', rel });
    } else if (lm && !nm) {
      ops.push({ action: inPrev ? 'delete-local' : 'push', rel });
    } else if (!lm && nm) {
      ops.push({ action: inPrev ? 'delete-nas' : 'pull', rel });
    }
  }
  return ops;
}

function applyDeletionSafety(ops, local, nas, prev) {
  const nasLoss = {}, localLoss = {}, prevCount = {};
  for (const rel of Object.keys(prev)) {
    const f = topFolder(rel);
    if (!f) continue;
    prevCount[f] = (prevCount[f] ?? 0) + 1;
    if (!nas.has(rel)) nasLoss[f] = (nasLoss[f] ?? 0) + 1;
    if (!local.has(rel)) localLoss[f] = (localLoss[f] ?? 0) + 1;
  }
  const suspect = new Set();
  for (const f of FOLDERS) {
    const prev_ = prevCount[f] ?? 0;
    if (prev_ === 0) continue;
    if ((nasLoss[f] ?? 0) / prev_ >= FOLDER_LOSS_RATIO_THRESHOLD) suspect.add(`nas:${f}`);
    if ((localLoss[f] ?? 0) / prev_ >= FOLDER_LOSS_RATIO_THRESHOLD) suspect.add(`local:${f}`);
  }
  const surviving = [];
  for (const op of ops) {
    const f = topFolder(op.rel);
    if (op.action === 'delete-local' && f && suspect.has(`nas:${f}`)) continue;
    if (op.action === 'delete-nas' && f && suspect.has(`local:${f}`)) continue;
    surviving.push(op);
  }
  return { ops: surviving, suspect: [...suspect], counts: { nasLoss, localLoss, prevCount } };
}

// ── Run the diagnostic ──
console.log('Scanning local + NAS…');
const local = collectFiles(LOCAL_BASE);
const nas = collectFiles(NAS_BASE);
const ls = readSyncState(LOCAL_BASE);
const ns = readSyncState(NAS_BASE);
const prev = ls.lastSync >= ns.lastSync ? ls.files : ns.files;

console.log(`  local: ${local.size} files | NAS: ${nas.size} files | prev: ${Object.keys(prev).length} files`);
console.log(`  using prev from ${ls.lastSync >= ns.lastSync ? 'local' : 'NAS'} state (lastSync=${ls.lastSync >= ns.lastSync ? ls.lastSync : ns.lastSync})\n`);

const rawOps = computeSyncOps(local, nas, prev);
const byAction = rawOps.reduce((acc, o) => { acc[o.action] = (acc[o.action] ?? 0) + 1; return acc; }, {});
console.log('Raw ops by action:', byAction);

const { ops: surviving, suspect, counts } = applyDeletionSafety(rawOps, local, nas, prev);

console.log('\nPer-folder loss snapshot (prev → side):');
for (const f of FOLDERS) {
  const p = counts.prevCount[f] ?? 0;
  if (p === 0) continue;
  const nl = counts.nasLoss[f] ?? 0;
  const ll = counts.localLoss[f] ?? 0;
  console.log(`  ${f.padEnd(18)} prev=${p}  NAS-lost=${nl} (${(nl/p*100).toFixed(1)}%)  local-lost=${ll} (${(ll/p*100).toFixed(1)}%)`);
}

console.log(`\nSuspect (loss ≥ 5%): ${suspect.length ? suspect.join(', ') : '(none)'}`);

const survivingDeletes = surviving.filter(o => o.action.startsWith('delete'));
console.log(`\nDelete ops surviving Layer 2: ${survivingDeletes.length}`);
for (const op of survivingDeletes) {
  console.log(`  ${op.action.padEnd(14)} ${op.rel}`);
}

const nonDelete = surviving.filter(o => !o.action.startsWith('delete'));
const ndByAction = nonDelete.reduce((acc, o) => { acc[o.action] = (acc[o.action] ?? 0) + 1; return acc; }, {});
console.log(`\nNon-delete ops surviving: ${nonDelete.length} (${JSON.stringify(ndByAction)})`);
