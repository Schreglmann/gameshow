#!/usr/bin/env node
const fs = require('fs');
const localDir = 'local-assets/audio/Woher kommt der Sound';
const nasDir = '/Volumes/Georg/Gameshow/Assets/audio/Woher kommt der Sound';

const target = 'PACMAN 1980 Intermission Sound.mp3';
console.log('looking for:', JSON.stringify(target));

for (const [label, dir] of [['local', localDir], ['NAS', nasDir]]) {
  const entries = fs.readdirSync(dir);
  const hit = entries.find(f => f.includes('PACMAN') && f.includes('1980'));
  if (!hit) {
    console.log(`${label}: NO PACMAN found`);
    continue;
  }
  console.log(`${label}: ${JSON.stringify(hit)} (len=${hit.length}, NFC?${hit === hit.normalize('NFC')}, NFD?${hit === hit.normalize('NFD')})`);
  // Print code points
  console.log(`  hex bytes: ${Buffer.from(hit).toString('hex')}`);
}
