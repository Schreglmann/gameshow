#!/usr/bin/env node
// One-shot migration: normalize all keys in .sync-state.json to Unicode NFC.
// Pre-fix the 2026-05-14 incident, the file held a mix of NFC and NFD keys
// because some entries originated from NAS scans (NFD on SMB) and others from
// local scans (NFC on APFS). The new code normalizes on parse, but persisting
// a clean NFC state file removes the diff churn on the next save.
const fs = require('fs');
const path = require('path');

// NOTE: one-shot CommonJS migration — the NAS path is hardcoded to the default.
// The configurable value lives in nas-sync-prefs.json (see specs/nas-sync-config.md);
// if your NAS path differs, edit the candidate below before running.
const candidates = [
  path.join(__dirname, '..', 'local-assets', '.sync-state.json'),
  '/Volumes/Georg/Gameshow/Assets/.sync-state.json',
];

for (const file of candidates) {
  if (!fs.existsSync(file)) {
    console.log(`skip (missing): ${file}`);
    continue;
  }
  const raw = fs.readFileSync(file, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) {
    console.warn(`skip (invalid JSON): ${file} — ${err.message}`);
    continue;
  }
  if (!parsed || typeof parsed.files !== 'object') {
    console.warn(`skip (unexpected shape): ${file}`);
    continue;
  }
  const before = Object.keys(parsed.files).length;
  const normFiles = {};
  let migrated = 0;
  for (const [k, v] of Object.entries(parsed.files)) {
    const nfc = k.normalize('NFC');
    if (nfc !== k) migrated++;
    normFiles[nfc] = v;
  }
  parsed.files = normFiles;
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + '\n');
  console.log(`${file}: ${before} → ${Object.keys(normFiles).length} keys (${migrated} migrated to NFC)`);
}
