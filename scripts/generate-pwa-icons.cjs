#!/usr/bin/env node
/* eslint-disable */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const apps = [
  { name: 'frontend', bg: [11, 11, 20], fg: [139, 92, 246] },
  { name: 'admin',    bg: [30, 41, 59], fg: [148, 163, 184] },
  { name: 'gamemaster', bg: [28, 25, 23], fg: [245, 158, 11] },
];

function hexPixel([r, g, b]) { return { r, g, b, a: 255 }; }

function makeIcon({ size, bg, fg, maskable }) {
  const png = new PNG({ width: size, height: size });
  const cx = size / 2;
  const cy = size / 2;
  const r = maskable ? size * 0.32 : size * 0.38;
  const bgPx = hexPixel(bg);
  const fgPx = hexPixel(fg);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const pixel = dist <= r ? fgPx : bgPx;
      png.data[idx] = pixel.r;
      png.data[idx + 1] = pixel.g;
      png.data[idx + 2] = pixel.b;
      png.data[idx + 3] = pixel.a;
    }
  }
  return PNG.sync.write(png);
}

const outRoot = path.resolve(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outRoot, { recursive: true });

for (const app of apps) {
  const variants = [
    { size: 192, maskable: false, suffix: '-192.png' },
    { size: 512, maskable: false, suffix: '-512.png' },
    { size: 512, maskable: true,  suffix: '-maskable-512.png' },
  ];
  for (const v of variants) {
    const buf = makeIcon({ size: v.size, bg: app.bg, fg: app.fg, maskable: v.maskable });
    const file = path.join(outRoot, `${app.name}${v.suffix}`);
    fs.writeFileSync(file, buf);
    console.log('wrote', file);
  }
}
