#!/usr/bin/env tsx

/**
 * validate-assets.ts — walk every game JSON in games/, extract asset references,
 * and verify each resolves to a real file in local-assets/. Honours the images
 * alias map and the video reference map. Read-only, always exits 0.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readAliasMap, resolveAlias, type AliasMap } from './server/asset-alias-map.js';
import { readReferenceMap, type VideoReferenceMap } from './server/video-reference-map.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = __dirname;
const GAMES_DIR = path.join(ROOT_DIR, 'games');
const LOCAL_ASSETS_BASE = path.join(ROOT_DIR, 'local-assets');

const GIT_CRYPT_MAGIC = Buffer.from([0x00, 0x47, 0x49, 0x54, 0x43, 0x52, 0x59, 0x50, 0x54, 0x00]);

function isGitCryptBlob(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(GIT_CRYPT_MAGIC.length);
    const bytesRead = fs.readSync(fd, head, 0, GIT_CRYPT_MAGIC.length, 0);
    fs.closeSync(fd);
    return bytesRead === GIT_CRYPT_MAGIC.length && head.equals(GIT_CRYPT_MAGIC);
  } catch {
    return false;
  }
}

type AssetCategory = 'images' | 'audio' | 'videos' | 'background-music';
const ASSET_REF_RE = /^\/?(images|audio|videos|background-music)\/(.+)$/;

interface AssetRef {
  raw: string;
  category: AssetCategory;
  relPath: string;
  jsonPath: string;
}

function walkStrings(value: unknown, pathSoFar: string, refs: AssetRef[]): void {
  if (typeof value === 'string') {
    const m = ASSET_REF_RE.exec(value);
    if (m) {
      refs.push({
        raw: value,
        category: m[1] as AssetCategory,
        relPath: m[2],
        jsonPath: pathSoFar,
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkStrings(value[i], `${pathSoFar}[${i}]`, refs);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walkStrings(v, pathSoFar ? `${pathSoFar}.${k}` : k, refs);
    }
  }
}

function describeLocation(jsonPath: string): string {
  const parts: string[] = [];
  const instMatch = /^instances\.([^.[]+)/.exec(jsonPath);
  if (instMatch) parts.push(`instance ${instMatch[1]}`);
  const qMatch = /questions\[(\d+)\]/.exec(jsonPath);
  if (qMatch) parts.push(`question #${qMatch[1]}`);
  let tail = jsonPath;
  if (qMatch) {
    tail = jsonPath.slice(jsonPath.indexOf(qMatch[0]) + qMatch[0].length).replace(/^\./, '');
  } else if (instMatch) {
    tail = jsonPath.slice(instMatch[0].length).replace(/^\./, '');
  }
  if (tail) parts.push(tail);
  return parts.join(', ') || jsonPath;
}

function checkExists(
  ref: AssetRef,
  imagesAliasMap: AliasMap,
  videoRefMap: VideoReferenceMap,
): 'present' | 'missing' | 'offline' {
  const catDir = path.join(LOCAL_ASSETS_BASE, ref.category);
  const full = path.join(catDir, ref.relPath);

  if (ref.category === 'videos') {
    // lstat treats a (possibly-dangling) symlink as present — the reference
    // workflow stores externally-sourced videos that way.
    try {
      fs.lstatSync(full);
      return 'present';
    } catch {
      if (videoRefMap[ref.relPath]) return 'offline';
      return 'missing';
    }
  }

  if (fs.existsSync(full)) return 'present';

  if (ref.category === 'images') {
    const base = path.basename(ref.relPath);
    const resolved = resolveAlias(imagesAliasMap, base);
    if (resolved !== base) {
      const altRel = path.join(path.dirname(ref.relPath), resolved);
      if (fs.existsSync(path.join(catDir, altRel))) return 'present';
    }
  }

  return 'missing';
}

async function main(): Promise<void> {
  const start = Date.now();
  console.log('🔍 Validating assets referenced by games...\n');

  if (!fs.existsSync(GAMES_DIR)) {
    console.error('❌ games/ directory not found.');
    return;
  }
  if (!fs.existsSync(LOCAL_ASSETS_BASE)) {
    console.warn(`⚠️  local-assets/ not found at ${LOCAL_ASSETS_BASE} — every asset will be reported missing.\n`);
  }

  const imagesAliasMap = await readAliasMap(path.join(LOCAL_ASSETS_BASE, 'images'));
  const videoRefMap = await readReferenceMap(path.join(LOCAL_ASSETS_BASE, 'videos'));

  const gameFiles = fs.readdirSync(GAMES_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_template') && !f.includes('.fingerprints.'))
    .sort();

  let totalRefs = 0;
  let totalMissing = 0;
  let totalOffline = 0;
  let totalGames = 0;
  let skippedEncrypted = 0;

  for (const file of gameFiles) {
    const full = path.join(GAMES_DIR, file);
    if (isGitCryptBlob(full)) { skippedEncrypted++; continue; }

    let content: Record<string, unknown>;
    try {
      content = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      console.warn(`⚠️  ${file}: invalid JSON (${(err as Error).message})`);
      continue;
    }

    const baseName = file.replace(/\.json$/, '');
    interface Inst { label: string; pathPrefix: string; obj: Record<string, unknown> }
    const instances: Inst[] = [];
    if (content.instances && typeof content.instances === 'object') {
      const { instances: rawInstances, ...base } = content as { instances: Record<string, Record<string, unknown>> } & Record<string, unknown>;
      for (const [instKey, instContent] of Object.entries(rawInstances)) {
        instances.push({
          label: `${baseName}/${instKey}`,
          pathPrefix: `instances.${instKey}`,
          obj: { ...base, ...instContent },
        });
      }
    } else {
      instances.push({ label: baseName, pathPrefix: '', obj: content });
    }

    totalGames += instances.length;

    for (const inst of instances) {
      const refs: AssetRef[] = [];
      walkStrings(inst.obj, '', refs);
      if (inst.pathPrefix) {
        for (const r of refs) {
          r.jsonPath = r.jsonPath ? `${inst.pathPrefix}.${r.jsonPath}` : inst.pathPrefix;
        }
      }

      const missing: AssetRef[] = [];
      const offline: AssetRef[] = [];
      for (const ref of refs) {
        const status = checkExists(ref, imagesAliasMap, videoRefMap);
        if (status === 'missing') missing.push(ref);
        else if (status === 'offline') offline.push(ref);
      }
      totalRefs += refs.length;
      totalMissing += missing.length;
      totalOffline += offline.length;

      const tag = missing.length > 0 ? '❌' : '✅';
      const offlineNote = offline.length > 0 ? `, ${offline.length} offline reference${offline.length === 1 ? '' : 's'}` : '';
      console.log(`${tag} ${inst.label} — ${refs.length} asset${refs.length === 1 ? '' : 's'} referenced, ${missing.length} missing${offlineNote}`);
      for (const m of missing) {
        console.log(`   ✗ ${m.raw}  (${describeLocation(m.jsonPath)})`);
      }
      for (const o of offline) {
        console.log(`   ⚠ ${o.raw}  (${describeLocation(o.jsonPath)}) — video reference, source offline`);
      }
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log('');
  console.log(
    `Total: ${totalGames} game/instance(s), ${totalRefs} asset reference(s), ${totalMissing} missing${
      totalOffline > 0 ? `, ${totalOffline} offline (video references)` : ''
    }  [${elapsed}s]`,
  );
  if (skippedEncrypted > 0) {
    console.log(`🔒 ${skippedEncrypted} game file(s) skipped (git-crypt encrypted).`);
  }
}

await main();
