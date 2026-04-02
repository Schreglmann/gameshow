#!/usr/bin/env node
/**
 * Post-processes hint SVGs to replace white overlay bars with transparent masks.
 *
 * The hint SVGs from logoquiz.net use white-filled rects/paths overlaid on the logo
 * to hide parts. This looks ugly on non-white backgrounds. This script converts
 * those white overlays into proper SVG masks so the hidden parts become transparent.
 *
 * Strategy: Compare each hint SVG with its answer SVG. Only elements that exist
 * in the hint but NOT in the answer are overlays. This prevents accidentally
 * removing white elements that are part of the actual logo design (e.g. Pepsi's
 * white background circle).
 *
 * Run after download-logos.sh: node fix-hint-svgs.mjs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const IMG_DIR = 'images/logo-quiz';

function isWhiteFill(element) {
  return /fill\s*[:=]\s*["']?\s*(white|#fff(fff)?|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/i.test(element);
}

function extractDAttribute(element) {
  const match = element.match(/\bd\s*=\s*"([^"]*)"/);
  return match ? match[1].trim() : null;
}

function extractElements(svgContent) {
  const elementRegex = /<(rect|path|polygon|circle|ellipse)\b[^>]*\/?>(?:<\/\1>)?/gi;
  const elements = [];
  let match;
  while ((match = elementRegex.exec(svgContent)) !== null) {
    elements.push(match[0]);
  }
  return elements;
}

function isOverlayElement(element, answerElements) {
  // Rects with white fill are always overlays (logos don't use raw rects as design)
  if (/^<rect\b/i.test(element) && isWhiteFill(element)) {
    return true;
  }

  // For paths with white fill, check if the same path exists in the answer SVG.
  // If it does, it's part of the logo design. If not, it's an overlay.
  if (isWhiteFill(element)) {
    const hintD = extractDAttribute(element);
    if (hintD) {
      const existsInAnswer = answerElements.some(ansEl => {
        const ansD = extractDAttribute(ansEl);
        return ansD && ansD === hintD;
      });
      // Only treat as overlay if this path does NOT exist in the answer
      return !existsInAnswer;
    }
    // White element without d attribute (circle, ellipse, etc) — check tag+attributes
    // If it has no d attribute and no matching element in answer, treat as overlay
    return true;
  }

  return false;
}

function changeToBlackFill(element) {
  return element
    .replace(/fill\s*=\s*"white"/gi, 'fill="black"')
    .replace(/fill\s*=\s*"#fff(fff)?"/gi, 'fill="black"')
    .replace(/fill\s*:\s*rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/gi, 'fill: rgb(0, 0, 0)')
    .replace(/fill\s*:\s*white/gi, 'fill: black')
    .replace(/fill\s*=\s*"rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)"/gi, 'fill="black"');
}

function processHintSvg(hintContent, answerContent) {
  const answerElements = extractElements(answerContent);
  const elementRegex = /<(rect|path|polygon|circle|ellipse)\b[^>]*\/?>(?:<\/\1>)?/gi;

  const overlayElements = [];
  const cleanedContent = hintContent.replace(elementRegex, (match) => {
    if (isOverlayElement(match, answerElements)) {
      overlayElements.push(match);
      return ''; // Remove overlay from content
    }
    return match;
  });

  if (overlayElements.length === 0) {
    return hintContent;
  }

  const maskElements = overlayElements.map(el => changeToBlackFill(el)).join('\n    ');

  const maskDef = `<defs>
    <mask id="hint-mask">
      <rect x="-99999" y="-99999" width="199998" height="199998" fill="white"/>
      ${maskElements}
    </mask>
  </defs>`;

  const svgOpenRegex = /(<svg[^>]*>)/i;
  const svgCloseRegex = /<\/svg>/i;

  let result = cleanedContent.replace(svgOpenRegex, `$1\n  ${maskDef}\n  <g mask="url(#hint-mask)">`);
  result = result.replace(svgCloseRegex, '  </g>\n</svg>');

  return result;
}

// Step 1: Normalize width/height and add viewBox padding to ALL SVGs.
// - Replaces width/height with large consistent values (so <img> renders them big)
// - Adds 5% padding to the viewBox so logos have breathing room
function normalizeSvg(content) {
  return content.replace(
    /(<svg\b)([^>]*?)(\s*>)/i,
    (match, open, attrs, close) => {
      // Strip existing width/height
      let cleaned = attrs
        .replace(/\s+width\s*=\s*"[^"]*"/gi, '')
        .replace(/\s+height\s*=\s*"[^"]*"/gi, '');

      // Add padding to viewBox, then set width/height based on aspect ratio
      let newWidth = 800;
      let newHeight = 800;
      cleaned = cleaned.replace(
        /viewBox\s*=\s*"([^"]*)"/i,
        (vbMatch, vbValue) => {
          const parts = vbValue.trim().split(/[\s,]+/).map(Number);
          if (parts.length === 4 && parts.every(n => !isNaN(n))) {
            const [x, y, w, h] = parts;
            const pad = Math.max(w, h) * 0.05;
            // Set width/height to large values preserving aspect ratio
            if (w >= h) {
              newWidth = 800;
              newHeight = Math.round(800 * (h / w));
            } else {
              newHeight = 800;
              newWidth = Math.round(800 * (w / h));
            }
            return `viewBox="${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}"`;
          }
          return vbMatch;
        }
      );

      // Add normalized width/height
      cleaned += ` width="${newWidth}" height="${newHeight}"`;

      return open + cleaned + close;
    }
  );
}

console.log('=== Step 1: Normalizing SVG dimensions ===');
let normalized = 0;

for (let level = 1; level <= 10; level++) {
  const dir = join(IMG_DIR, `level${level}`);
  let files;
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.svg'));
  } catch {
    continue;
  }

  for (const file of files) {
    const filePath = join(dir, file);
    const content = readFileSync(filePath, 'utf-8');
    const result = normalizeSvg(content);
    if (result !== content) {
      writeFileSync(filePath, result);
      normalized++;
    }
  }
}
console.log(`  Normalized ${normalized} SVGs (removed fixed width/height)\n`);

// Step 2: Fix hint SVG white overlays
console.log('=== Step 2: Fixing hint SVG white overlays ===');
let processed = 0;
let skipped = 0;
let noAnswer = 0;

for (let level = 1; level <= 10; level++) {
  const dir = join(IMG_DIR, `level${level}`);
  let files;
  try {
    files = readdirSync(dir).filter(f => f.endsWith('-hint.svg'));
  } catch {
    console.log(`  Skipping level${level} (directory not found)`);
    continue;
  }

  for (const file of files) {
    const hintPath = join(dir, file);
    const answerPath = join(dir, file.replace('-hint.svg', '.svg'));

    if (!existsSync(answerPath)) {
      console.log(`  No answer SVG for ${file}, skipping`);
      noAnswer++;
      continue;
    }

    const hintContent = readFileSync(hintPath, 'utf-8');
    const answerContent = readFileSync(answerPath, 'utf-8');
    const result = processHintSvg(hintContent, answerContent);

    if (result !== hintContent) {
      writeFileSync(hintPath, result);
      console.log(`  Fixed: ${hintPath}`);
      processed++;
    } else {
      console.log(`  No overlays: ${file}`);
      skipped++;
    }
  }
}

console.log(`\nDone! Normalized ${normalized} SVGs, fixed ${processed} hint overlays, ${skipped} had no overlays, ${noAnswer} missing answer files.`);
