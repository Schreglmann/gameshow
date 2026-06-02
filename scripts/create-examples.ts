#!/usr/bin/env tsx
/**
 * CLI for the example games ("Beispiele"). Runs the same `materializeExamples`
 * that backs the admin "Beispiele erstellen" button: generates one example game
 * per type (except video-guess) + their self-synthesized media, then adds and
 * activates the "Beispiele" gameshow.
 *
 * Run from the repo root: `npm run fixtures`. Idempotent. See specs/example-games.md.
 */

import path from 'path';
import { ROOT_DIR, LOCAL_ASSETS_BASE } from '../server/asset-paths.js';
import { materializeExamples } from '../server/example-games.js';

const result = await materializeExamples({
  gamesDir: path.join(ROOT_DIR, 'games'),
  localAssetsBase: LOCAL_ASSETS_BASE,
  configPath: path.join(ROOT_DIR, 'config.json'),
});

console.log(`✅ ${result.createdGames.length} Beispiel-Spiele erstellt, Gameshow "${result.gameshow}" aktiviert.`);
console.log(`   ${result.createdGames.join(', ')}`);
