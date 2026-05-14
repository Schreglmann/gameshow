#!/usr/bin/env node
// One-shot recovery: move every file from the two trash runs on 2026-05-14
// back to its original location under local-assets/. Skips any file whose
// destination already exists (e.g. someone re-uploaded it after the sync ran).
const fs = require('fs');
const path = require('path');

const base = path.resolve(__dirname, '..', 'local-assets');
const runs = ['.trash/2026-05-14T07-40-22-182Z', '.trash/2026-05-14T07-45-22-171Z'];

let restored = 0;
let conflicts = 0;
const conflictList = [];

function walk(dir, runRoot) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, runRoot);
    } else if (entry.isFile()) {
      const rel = path.relative(runRoot, full);
      const dest = path.join(base, rel);
      if (fs.existsSync(dest)) {
        conflicts++;
        conflictList.push(rel);
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(full, dest);
      restored++;
    }
  }
}

for (const run of runs) {
  const runRoot = path.join(base, run);
  if (!fs.existsSync(runRoot)) continue;
  walk(runRoot, runRoot);
}

console.log('Restored:', restored);
console.log('Conflicts (file already present at destination):', conflicts);
if (conflictList.length > 0) {
  console.log('Conflict samples:');
  conflictList.slice(0, 10).forEach(f => console.log('  -', f));
}
