#!/usr/bin/env node
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('local-assets/.sync-state.json', 'utf8'));
const keys = Object.keys(state.files);
const nonNfc = keys.filter(k => k !== k.normalize('NFC'));
const nfc = keys.filter(k => k === k.normalize('NFC'));
console.log('state NFC:', nfc.length, ' non-NFC (NFD):', nonNfc.length);
console.log('Sample non-NFC keys (first 5):');
nonNfc.slice(0, 5).forEach(k => console.log(' ', JSON.stringify(k)));
