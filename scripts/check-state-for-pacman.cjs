#!/usr/bin/env node
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('local-assets/.sync-state.json', 'utf8'));
const targets = [
  'audio/Woher kommt der Sound/PACMAN 1980 Intermission Sound.mp3',
  'audio/Woher kommt der Sound/Star Wars Sound Effects - Sith Lightsaber Ignition & Retraction.mp3',
  'images/Woher kommt der Sound/500px-AOL_logo_%282024%29.svg.png',
];
for (const t of targets) {
  const inState = Object.prototype.hasOwnProperty.call(state.files, t);
  console.log(`${inState ? '✓' : '✗'} in state: ${t}`);
}
// Show all PACMAN-related entries
const keys = Object.keys(state.files).filter(k => k.includes('PACMAN') || k.includes('Star Wars') || k.includes('AOL'));
console.log('\nAll matching state keys:');
keys.forEach(k => console.log('  ', JSON.stringify(k), '→', state.files[k]));
