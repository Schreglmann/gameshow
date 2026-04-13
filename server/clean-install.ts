/**
 * Clean-install support — detect git-crypt encrypted files and produce a
 * template-based default config when the real config.json is unavailable.
 *
 * See specs/clean-install.md.
 */

import path from 'path';
import { readdir, readFile } from 'fs/promises';
import type { AppConfig } from '../src/types/config.js';

/**
 * git-crypt encrypts files with a magic header of `\0GITCRYPT\0` followed by
 * a nonce. When the repo is cloned without the unlock key, encrypted files
 * appear as raw blobs starting with these bytes.
 */
export const GIT_CRYPT_MAGIC = Buffer.from([0x00, 0x47, 0x49, 0x54, 0x43, 0x52, 0x59, 0x50, 0x54, 0x00]);

export function isGitCryptBlob(buffer: Buffer): boolean {
  if (buffer.length < GIT_CRYPT_MAGIC.length) return false;
  return buffer.subarray(0, GIT_CRYPT_MAGIC.length).equals(GIT_CRYPT_MAGIC);
}

/**
 * Scan `<gamesDir>/_template-*.json` and build a default gameOrder referencing
 * every template that has an `instances.template` entry (multi-instance) or
 * no instances at all (single-instance). Encrypted blobs and invalid files
 * are skipped.
 */
export async function buildDefaultGameOrder(gamesDir: string): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(gamesDir);
  } catch {
    return [];
  }
  const templates = files.filter(f => f.startsWith('_template-') && f.endsWith('.json')).sort();
  const gameOrder: string[] = [];
  for (const file of templates) {
    const fullPath = path.join(gamesDir, file);
    try {
      const raw = await readFile(fullPath);
      if (isGitCryptBlob(raw)) continue;
      const content = JSON.parse(raw.toString('utf8')) as { instances?: Record<string, unknown> };
      const name = file.replace(/\.json$/, '');
      if (content.instances && typeof content.instances === 'object') {
        if ('template' in content.instances) {
          gameOrder.push(`${name}/template`);
        }
      } else {
        gameOrder.push(name);
      }
    } catch {
      /* skip unreadable/invalid template */
    }
  }
  return gameOrder;
}

export async function buildDefaultConfig(gamesDir: string): Promise<AppConfig> {
  const gameOrder = await buildDefaultGameOrder(gamesDir);
  return {
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [
      'Es gibt mehrere Spiele.',
      'Bei jedem Spiel wird am Ende entschieden welches Team das Spiel gewonnen hat.',
      'Das erste Spiel ist 1 Punkt wert, das zweite 2 Punkte, etc.',
      'Das Team mit den meisten Punkten gewinnt am Ende.',
    ],
    activeGameshow: 'default',
    gameshows: {
      default: {
        name: 'Beispiel-Gameshow',
        gameOrder,
      },
    },
  };
}

/**
 * Load config.json, falling back to the template-based default when the file
 * is missing, encrypted, or unparseable. Returns both the config and a flag
 * indicating whether the fallback was used.
 */
export async function loadConfigWithFallback(
  configPath: string,
  gamesDir: string,
): Promise<{ config: AppConfig; isCleanInstall: boolean }> {
  let raw: Buffer;
  try {
    raw = await readFile(configPath);
  } catch {
    return { config: await buildDefaultConfig(gamesDir), isCleanInstall: true };
  }
  if (isGitCryptBlob(raw)) {
    return { config: await buildDefaultConfig(gamesDir), isCleanInstall: true };
  }
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as AppConfig;
    return { config: parsed, isCleanInstall: false };
  } catch {
    return { config: await buildDefaultConfig(gamesDir), isCleanInstall: true };
  }
}
