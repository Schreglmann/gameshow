#!/usr/bin/env node
/* eslint-disable */
// Generates the PWA icons + favicons for all three apps from the approved
// "converging spotlights" design (see specs/pwa.md, Icons section): two gold
// stage lamps in the top corners whose beams meet (not cross) on a glyph
// standing in the merged light — star (show), sliders (admin), play
// (gamemaster) — on the atlas royal-navy stage.
//
// Outputs to public/icons/:
//   {frontend,admin,gamemaster}-192.png            standard icons
//   {frontend,admin,gamemaster}-512.png
//   {frontend,admin,gamemaster}-maskable-512.png   content scaled 0.68 into
//                                                  the Android safe circle
//   {frontend,admin,gamemaster}.svg                per-app favicons (rounded)
// plus public/favicon.svg (= the show favicon, root fallback).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// atlas palette (src/styles/themes.css)
const navy = '#0f1f44', cone = '#1e3c80', pool = '#27498f';
const gold = '#ffd45e', ivory = '#f3ecd8', crimson = '#ff5d6c';

const u = d => { const r = (d * Math.PI) / 180; return [Math.sin(r), -Math.cos(r)]; };
const pt = (cx, cy, d, len) => { const [x, y] = u(d); return [cx + x * len, cy + y * len]; };
const F = n => +n.toFixed(1);

// 4-point sparkle star: long points N/E/S/W (radius R), short diagonals (radius r)
const sparkle = (cx, cy, R, r, fill) => {
  const p = [];
  for (let i = 0; i < 4; i++) { p.push(pt(cx, cy, i * 90, R)); p.push(pt(cx, cy, i * 90 + 45, r)); }
  return `<polygon points="${p.map(q => q.map(F).join(',')).join(' ')}" fill="${fill}"/>`;
};

// Per-app glyph standing in the light. `favicon` swaps the show glyph for a
// single bigger star (no companion sparkle) so it stays crisp at 16px.
function glyph(app, favicon) {
  if (app === 'frontend') {
    return favicon
      ? sparkle(256, 296, 96, 34, gold)
      : sparkle(256, 300, 88, 31, gold) + sparkle(338, 216, 22, 9, ivory);
  }
  if (app === 'admin') {
    let s = '';
    for (const [y, kx] of [[248, 210], [300, 318], [352, 176]]) {
      s += `<line x1="148" y1="${y}" x2="364" y2="${y}" stroke="${ivory}" stroke-width="13" stroke-linecap="round"/>` +
        `<circle cx="${kx}" cy="${y}" r="16" fill="${gold}"/>`;
    }
    return s;
  }
  return `<polygon points="212,242 212,358 324,300" fill="${crimson}"/>`;
}

// Full icon SVG. rx rounds the background (favicons only — PNG app icons are
// full-bleed; launchers apply their own masks). scale shrinks the content
// about the center for the maskable variants.
function buildIcon(app, { rx = 0, scale = 1, favicon = false } = {}) {
  const content =
    `<polygon points="68,56 256,200 444,56 391,418 121,418" fill="${cone}"/>` +
    `<ellipse cx="256" cy="416" rx="147" ry="22" fill="${pool}"/>` +
    glyph(app, favicon) +
    `<circle cx="68" cy="56" r="21" fill="${gold}"/>` +
    `<circle cx="444" cy="56" r="21" fill="${gold}"/>`;
  const wrapped = scale === 1 ? content
    : `<g transform="translate(${F(256 * (1 - scale))} ${F(256 * (1 - scale))}) scale(${scale})">${content}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" rx="${rx}" fill="${navy}"/>` + wrapped + `</svg>\n`;
}

const outRoot = path.resolve(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outRoot, { recursive: true });

async function main() {
  for (const app of ['frontend', 'admin', 'gamemaster']) {
    const variants = [
      { size: 192, svg: buildIcon(app), suffix: '-192.png' },
      { size: 512, svg: buildIcon(app), suffix: '-512.png' },
      { size: 512, svg: buildIcon(app, { scale: 0.68 }), suffix: '-maskable-512.png' },
    ];
    for (const v of variants) {
      const file = path.join(outRoot, `${app}${v.suffix}`);
      await sharp(Buffer.from(v.svg), { density: 150 }).resize(v.size, v.size).png().toFile(file);
      console.log('wrote', file);
    }
    const faviconSvg = buildIcon(app, { rx: 100, favicon: true });
    const svgFile = path.join(outRoot, `${app}.svg`);
    fs.writeFileSync(svgFile, faviconSvg);
    console.log('wrote', svgFile);
  }
  // Root favicon fallback (`/` redirects to /show/) = the show favicon.
  const rootFavicon = path.resolve(__dirname, '..', 'public', 'favicon.svg');
  fs.writeFileSync(rootFavicon, buildIcon('frontend', { rx: 100, favicon: true }));
  console.log('wrote', rootFavicon);
}

main().catch(err => { console.error(err); process.exit(1); });
