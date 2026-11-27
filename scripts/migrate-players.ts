#!/usr/bin/env tsx
/**
 * Move the old per-gameshow player names into the global player registry.
 * See specs/players.md.
 *
 *   npx tsx scripts/migrate-players.ts --template > ~/players-mapping.json
 *       Print a mapping skeleton with every old name. Fill in the full names,
 *       and put names that mean the same person into one entry's `aliases`.
 *       The first alias becomes the nickname shown in the game (a trailing
 *       surname initial like " H." is dropped).
 *   npx tsx scripts/migrate-players.ts ~/players-mapping.json
 *       Dry run: print what would change.
 *   npx tsx scripts/migrate-players.ts ~/players-mapping.json --write
 *       Write config.json. Run `npm run validate` afterwards.
 *
 * The mapping holds real names — keep it outside the repo.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AppConfig } from '../src/types/config';
import { adminLabel } from '../src/utils/playerNames';
import { isGitCryptBlob } from '../server/clean-install';
import { mappingTemplate, migratePlayers, type PlayerMapping } from './lib/migrate-players';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const configArg = args.indexOf('--config');
const configPath = configArg >= 0 && args[configArg + 1] ? path.resolve(args[configArg + 1]!) : path.join(ROOT, 'config.json');
const write = args.includes('--write');
const template = args.includes('--template');
const mappingPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--config');

const raw = fs.readFileSync(configPath);
if (isGitCryptBlob(raw)) {
  console.error('❌ config.json is git-crypt encrypted — unlock the repo first (git-crypt unlock).');
  process.exit(1);
}
const config = JSON.parse(raw.toString('utf8')) as AppConfig;

if (template) {
  process.stdout.write(`${JSON.stringify(mappingTemplate(config), null, 2)}\n`);
  process.exit(0);
}

if (!mappingPath) {
  console.error('Usage: npx tsx scripts/migrate-players.ts --template | <mapping.json> [--write] [--config <path>]');
  process.exit(1);
}

const mapping = JSON.parse(fs.readFileSync(path.resolve(mappingPath), 'utf8')) as PlayerMapping;
const { config: migrated, report } = migratePlayers(config, mapping);

for (const error of report.errors) console.error(`❌ ${error}`);
if (report.errors.length > 0) {
  console.error('\nNothing written. Fix the mapping and run again.');
  process.exit(1);
}
for (const warning of report.warnings) console.warn(`⚠️  ${warning}`);
console.log(`New players (${report.created.length}): ${report.created.map(p => `${adminLabel(p)} [${p.id}]`).join(', ') || '—'}`);
if (report.reused.length > 0) console.log(`Already in the registry (${report.reused.length}): ${report.reused.map(p => adminLabel(p)).join(', ')}`);
console.log(`Gameshows changed (${report.changedShows.length}): ${report.changedShows.join(', ') || '—'}`);

if (report.created.length === 0 && report.changedShows.length === 0) {
  console.log('\nNichts zu tun.');
  process.exit(0);
}
if (!write) {
  console.log('\nDry run — add --write to save config.json.');
  process.exit(0);
}

// Atomic write: a crash mid-write must never leave a truncated config.json.
const indent = /^\{\n( +)"/.exec(raw.toString('utf8'))?.[1]?.length ?? 2;
const tmp = `${configPath}.tmp`;
fs.writeFileSync(tmp, `${JSON.stringify(migrated, null, indent)}\n`);
fs.renameSync(tmp, configPath);
console.log(`\n✅ ${path.relative(ROOT, configPath)} written. Now run: npm run validate`);
