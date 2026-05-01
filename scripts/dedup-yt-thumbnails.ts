#!/usr/bin/env npx tsx
/**
 * Deduplicate YouTube Thumbnails in Audio-Covers.
 *
 * Two phases:
 *   Phase 1 — Within `YouTube Thumbnails/`: group by content hash, keep the
 *             first file (alphabetically, preferring game-referenced files).
 *   Phase 2 — Cross-folder: for each surviving YT file, if an identical image
 *             exists in the parent `Audio-Covers/` root, delete the root copy
 *             (keeping the YT version). Referenced root files are skipped.
 *
 * Usage:
 *   npx tsx scripts/dedup-yt-thumbnails.ts          # dry-run (default)
 *   npx tsx scripts/dedup-yt-thumbnails.ts --apply   # delete after confirmation
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';

const COVERS_DIR = path.resolve('local-assets/images/Audio-Covers');
const YT_DIR = path.join(COVERS_DIR, 'YouTube Thumbnails');
const APPLY = process.argv.includes('--apply');

function fileHash(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(data).digest('hex');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImage(f: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(f);
}

/** Collect all game-referenced Audio-Covers paths (relative to Audio-Covers/). */
function collectGameRefs(): Set<string> {
  const gamesDir = path.resolve('games');
  const refs = new Set<string>();
  for (const gf of fs.readdirSync(gamesDir)) {
    if (!gf.endsWith('.json') || gf.startsWith('_')) continue;
    const data = fs.readFileSync(path.join(gamesDir, gf), 'utf8');
    const regex = /\/images\/Audio-Covers\/([^"]+)/g;
    let match;
    while ((match = regex.exec(data)) !== null) {
      refs.add(match[1]);
    }
  }
  return refs;
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function main() {
  if (!fs.existsSync(YT_DIR)) {
    console.log(`Directory not found: ${YT_DIR}`);
    process.exit(1);
  }

  const referencedFiles = collectGameRefs();

  // ── Phase 1: Within YouTube Thumbnails ──
  console.log('\n═══ Phase 1: Deduplicate within YouTube Thumbnails ═══\n');

  const ytFiles = fs.readdirSync(YT_DIR).filter(f => !f.startsWith('.') && isImage(f));
  console.log(`📂 Scanning ${ytFiles.length} files...\n`);

  const ytGroups = new Map<string, { name: string; size: number }[]>();
  for (const f of ytFiles) {
    const fullPath = path.join(YT_DIR, f);
    const hash = fileHash(fullPath);
    const size = fs.statSync(fullPath).size;
    if (!ytGroups.has(hash)) ytGroups.set(hash, []);
    ytGroups.get(hash)!.push({ name: f, size });
  }

  const dupeGroups = [...ytGroups.entries()]
    .filter(([, g]) => g.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  let phase1Waste = 0;
  const phase1Plan: { file: string; dir: string }[] = [];

  if (dupeGroups.length === 0) {
    console.log('✅ No within-folder duplicates.\n');
  } else {
    for (const [hash, group] of dupeGroups) {
      const sorted = group.sort((a, b) => a.name.localeCompare(b.name));
      const ytRefKey = (f: string) => `YouTube Thumbnails/${f}`;
      const refIdx = sorted.findIndex(f => referencedFiles.has(ytRefKey(f.name)));
      const keepIdx = refIdx >= 0 ? refIdx : 0;
      const keep = sorted[keepIdx];
      const deleteFiles = sorted.filter((_, i) => i !== keepIdx);

      console.log(`── Group (${group.length} files, ${formatBytes(keep.size)} each, hash: ${hash.slice(0, 8)}…) ──`);
      console.log(`  ✅ Keep:   ${keep.name}${referencedFiles.has(ytRefKey(keep.name)) ? ' [referenced]' : ''}`);
      for (const f of deleteFiles) {
        const isRef = referencedFiles.has(ytRefKey(f.name));
        console.log(`  🗑  Delete: ${f.name}${isRef ? ' ⚠️  [referenced — will NOT delete]' : ''}`);
        if (!isRef) {
          phase1Plan.push({ file: f.name, dir: YT_DIR });
          phase1Waste += f.size;
        }
      }
      console.log();
    }
  }

  // Build hash map of surviving YT files (after phase 1 deletions)
  const phase1DeleteSet = new Set(phase1Plan.map(p => p.file));
  const survivingYt = new Map<string, string>(); // hash -> filename
  for (const [hash, group] of ytGroups) {
    for (const f of group.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!phase1DeleteSet.has(f.name) && !survivingYt.has(hash)) {
        survivingYt.set(hash, f.name);
      }
    }
  }

  // ── Phase 2: Cross-folder (root Audio-Covers vs surviving YT) ──
  console.log('═══ Phase 2: Cross-folder dedup (root vs YouTube Thumbnails) ═══\n');

  const rootFiles = fs.readdirSync(COVERS_DIR).filter(
    f => !f.startsWith('.') && !fs.statSync(path.join(COVERS_DIR, f)).isDirectory() && isImage(f),
  );

  // Hash root files and check against surviving YT
  const rootHashCache = new Map<string, string>(); // filename -> hash
  for (const f of rootFiles) {
    rootHashCache.set(f, fileHash(path.join(COVERS_DIR, f)));
  }

  let phase2Waste = 0;
  const phase2Plan: { file: string; dir: string; ytMatch: string }[] = [];
  const phase2Skipped: { root: string; yt: string }[] = [];

  for (const rootFile of rootFiles) {
    const rootHash = rootHashCache.get(rootFile)!;
    const ytMatch = survivingYt.get(rootHash);
    if (!ytMatch) continue;

    const rootSize = fs.statSync(path.join(COVERS_DIR, rootFile)).size;
    const isRef = referencedFiles.has(rootFile);

    if (isRef) {
      phase2Skipped.push({ root: rootFile, yt: ytMatch });
    } else {
      phase2Plan.push({ file: rootFile, dir: COVERS_DIR, ytMatch });
      phase2Waste += rootSize;
    }
  }

  if (phase2Plan.length === 0 && phase2Skipped.length === 0) {
    console.log('✅ No cross-folder duplicates.\n');
  } else {
    if (phase2Plan.length > 0) {
      console.log(`🗑  ${phase2Plan.length} root files to delete (identical content in YT Thumbnails):\n`);
      for (const p of phase2Plan.sort((a, b) => a.file.localeCompare(b.file))) {
        console.log(`  🗑  Root: ${p.file}  →  keeping YT: ${p.ytMatch}`);
      }
      console.log();
    }

    if (phase2Skipped.length > 0) {
      console.log(`⚠️  ${phase2Skipped.length} root files skipped (referenced by games, keeping both):\n`);
      for (const s of phase2Skipped.sort((a, b) => a.root.localeCompare(b.root))) {
        console.log(`  ⏭  Root: ${s.root} [referenced]  ↔  YT: ${s.yt}`);
      }
      console.log();
    }
  }

  // ── Summary ──
  const totalDeletes = phase1Plan.length + phase2Plan.length;
  const totalWaste = phase1Waste + phase2Waste;

  console.log('═══ Summary ═══\n');
  console.log(`   Phase 1 (within YT):      ${phase1Plan.length} files to delete (${formatBytes(phase1Waste)})`);
  console.log(`   Phase 2 (cross-folder):    ${phase2Plan.length} files to delete (${formatBytes(phase2Waste)})`);
  console.log(`   Skipped (referenced):      ${phase2Skipped.length} files kept`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   Total:                     ${totalDeletes} files (${formatBytes(totalWaste)})\n`);

  if (totalDeletes === 0) {
    console.log('Nothing to delete.\n');
    return;
  }

  if (!APPLY) {
    console.log('ℹ️  Dry run — no files deleted. Run with --apply to delete duplicates.\n');
    return;
  }

  const yes = await confirm(`Delete ${totalDeletes} duplicate files? (y/N) `);
  if (!yes) {
    console.log('Aborted.');
    return;
  }

  let deleted = 0;
  for (const p of [...phase1Plan, ...phase2Plan]) {
    const fullPath = path.join(p.dir, p.file);
    try {
      fs.unlinkSync(fullPath);
      deleted++;
    } catch (err) {
      console.warn(`  ⚠️  Failed to delete ${p.file}: ${(err as Error).message}`);
    }
  }

  console.log(`\n✅ Deleted ${deleted}/${totalDeletes} duplicate files.`);
  console.log(`   Freed ~${formatBytes(totalWaste)}\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
