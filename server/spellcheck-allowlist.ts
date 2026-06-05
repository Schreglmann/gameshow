/**
 * Spellcheck config + allowlist sidecar.
 *
 * Holds the global on/off switch (`enabled`, default false) plus the two kinds of
 * false-positive overrides: allowed words (spelling) and ignored match fingerprints
 * (grammar/other). Stored as a committed, plaintext repo-root file
 * `spellcheck-allowlist.json` — NOT git-crypt encrypted (it is shareable vocabulary,
 * and the git-crypt globs only match `games/*.json` + `config.json`). It is invisible
 * to `GET /api/backend/games` (that handler only reads `games/`) and not referenced by
 * `gameOrder`, so `validate-config.ts` ignores it.
 *
 * Mirrors the atomic dotfile-sidecar pattern in `audio-cover-meta.ts`:
 * validating reader → safe default on any error; tmp-write + rename; trailing newline.
 */

import path from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, rename } from 'fs/promises';
import { ROOT_DIR } from './asset-paths.js';
import { normalizeAllowedWord } from '../src/utils/spellcheckFingerprint.js';

export const ALLOWLIST_VERSION = 1;

export interface SpellcheckConfig {
  version: number;
  /** Global master switch. Default false — feature is fully off until the user opts in. */
  enabled: boolean;
  /** Skip likely proper names: a capitalized spelling match with no close correction is not
   *  flagged. Default true — so names (people, bands, places, titles) aren't marked as errors,
   *  while genuine typos (which always get a near suggestion) stay flagged. */
  skipNames: boolean;
  /** Spelling false-positives; matched case-insensitively (NFC + lowercase + trim). */
  allowedWords: string[];
  /** Grammar/other false-positives, by match fingerprint (see spellMatchFingerprint). */
  ignoredMatches: string[];
}

export function allowlistPath(rootDir: string = ROOT_DIR): string {
  return path.join(rootDir, 'spellcheck-allowlist.json');
}

function defaultConfig(): SpellcheckConfig {
  return { version: ALLOWLIST_VERSION, enabled: false, skipNames: true, allowedWords: [], ignoredMatches: [] };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

export async function readConfig(rootDir: string = ROOT_DIR): Promise<SpellcheckConfig> {
  const file = allowlistPath(rootDir);
  if (!existsSync(file)) return defaultConfig();
  try {
    const raw = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultConfig();
    const p = parsed as Record<string, unknown>;
    return {
      version: typeof p.version === 'number' ? p.version : ALLOWLIST_VERSION,
      enabled: p.enabled === true,
      // Legacy files without the field default to true, so name-skipping works on upgrade.
      skipNames: p.skipNames !== false,
      allowedWords: asStringArray(p.allowedWords),
      ignoredMatches: asStringArray(p.ignoredMatches),
    };
  } catch {
    return defaultConfig();
  }
}

async function writeConfig(config: SpellcheckConfig, rootDir: string = ROOT_DIR): Promise<void> {
  const file = allowlistPath(rootDir);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

export async function setEnabled(enabled: boolean, rootDir: string = ROOT_DIR): Promise<SpellcheckConfig> {
  const config = await readConfig(rootDir);
  config.enabled = enabled;
  await writeConfig(config, rootDir);
  return config;
}

export async function setSkipNames(skipNames: boolean, rootDir: string = ROOT_DIR): Promise<SpellcheckConfig> {
  const config = await readConfig(rootDir);
  config.skipNames = skipNames;
  await writeConfig(config, rootDir);
  return config;
}

export async function addWord(word: string, rootDir: string = ROOT_DIR): Promise<SpellcheckConfig> {
  const config = await readConfig(rootDir);
  const trimmed = word.trim();
  if (trimmed) {
    const norm = normalizeAllowedWord(trimmed);
    const exists = config.allowedWords.some(w => normalizeAllowedWord(w) === norm);
    if (!exists) config.allowedWords.push(trimmed);
    await writeConfig(config, rootDir);
  }
  return config;
}

export async function removeWord(word: string, rootDir: string = ROOT_DIR): Promise<SpellcheckConfig> {
  const config = await readConfig(rootDir);
  const norm = normalizeAllowedWord(word);
  config.allowedWords = config.allowedWords.filter(w => normalizeAllowedWord(w) !== norm);
  await writeConfig(config, rootDir);
  return config;
}

export async function addIgnore(fingerprint: string, rootDir: string = ROOT_DIR): Promise<SpellcheckConfig> {
  const config = await readConfig(rootDir);
  const fp = fingerprint.trim();
  if (fp && !config.ignoredMatches.includes(fp)) {
    config.ignoredMatches.push(fp);
    await writeConfig(config, rootDir);
  }
  return config;
}

export async function removeIgnore(fingerprint: string, rootDir: string = ROOT_DIR): Promise<SpellcheckConfig> {
  const config = await readConfig(rootDir);
  config.ignoredMatches = config.ignoredMatches.filter(fp => fp !== fingerprint);
  await writeConfig(config, rootDir);
  return config;
}
