#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const NAS_BASE = '/Volumes/Georg/Gameshow/Assets';
const LOCAL_BASE = path.join(__dirname, '..', 'local-assets');

function walk(baseDir, folder) {
  const results = [];
  const root = path.join(baseDir, folder);
  if (!fs.existsSync(root)) return results;
  function inner(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.smbdelete') || entry.name.startsWith('.smbtemp')) continue;
      if (entry.name === '.trash') continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name.includes('.transcoding.') || entry.name === 'backup') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) inner(full);
      else if (entry.isFile()) results.push(path.relative(baseDir, full).normalize('NFC'));
    }
  }
  inner(root);
  return results;
}

const target = 'audio/Woher kommt der Sound/PACMAN 1980 Intermission Sound.mp3';
console.log('Target:', JSON.stringify(target));
console.log('Target NFC?', target === target.normalize('NFC'));

const nasFiles = walk(NAS_BASE, 'audio');
const localFiles = walk(LOCAL_BASE, 'audio');

console.log('\nNAS audio entries matching PACMAN:');
nasFiles.filter(f => f.includes('PACMAN')).forEach(f => console.log(' ', JSON.stringify(f), 'eq?', f === target));

console.log('\nLocal audio entries matching PACMAN:');
localFiles.filter(f => f.includes('PACMAN')).forEach(f => console.log(' ', JSON.stringify(f), 'eq?', f === target));

// Compare folder names byte-by-byte
const localWoher = fs.readdirSync(LOCAL_BASE + '/audio').filter(f => f.includes('Woher'))[0];
const nasWoher = fs.readdirSync(NAS_BASE + '/audio').filter(f => f.includes('Woher'))[0];
console.log('\nFolder names:');
console.log('  local:', JSON.stringify(localWoher), 'hex:', Buffer.from(localWoher).toString('hex'));
console.log('  NAS:  ', JSON.stringify(nasWoher), 'hex:', Buffer.from(nasWoher).toString('hex'));
console.log('  eq?', localWoher === nasWoher);
