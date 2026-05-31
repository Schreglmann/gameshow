/**
 * Clean-install support — detect git-crypt encrypted files and produce a
 * minimal default config (a single empty "Beispiele" gameshow) when the real
 * config.json is unavailable. The admin "Spiele" tab then offers a "Beispiele
 * erstellen" button to populate it from code fixtures (see specs/example-games.md).
 *
 * See specs/clean-install.md.
 */

import { readFile, writeFile, rename } from 'fs/promises';
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
 * Build the minimal default config used when config.json is missing, encrypted,
 * or unparseable. It defines a single empty "Beispiele" gameshow (active) plus
 * the show-level globalRules and shared rulesPresets. The gameOrder is filled by
 * `materializeExamples` (server/example-games.ts) when the user clicks "Beispiele
 * erstellen" or runs `npm run fixtures`.
 */
export function buildDefaultConfig(): AppConfig {
  return {
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [
      'Es gibt mehrere Spiele.',
      'Bei jedem Spiel wird am Ende entschieden welches Team das Spiel gewonnen hat.',
      'Das erste Spiel ist 1 Punkt wert, das zweite 2 Punkte, etc.',
      'Das Team mit den meisten Punkten gewinnt am Ende.',
    ],
    rulesPresets: [
      {
        id: 'simultaneous-written',
        name: 'Gleichzeitig schriftlich',
        rules: [
          'Jede Frage wird beiden Teams gleichzeitig gestellt.',
          'Die Teams schreiben ihre Antwort auf.',
        ],
      },
      {
        id: 'simultaneous-race',
        name: 'Gleichzeitig (erste Antwort zählt)',
        rules: [
          'Beide Teams raten gleichzeitig.',
          'Die erste Antwort eines Teams zählt.',
          'Antwortet ein Team falsch, darf das andere Team antworten.',
        ],
      },
      {
        id: 'alternating',
        name: 'Abwechselnd',
        rules: [
          'Die Teams raten abwechselnd.',
          'Antwortet ein Team falsch oder nicht, darf das andere Team antworten.',
        ],
      },
      {
        id: 'simultaneous-first-correct',
        name: 'Gleichzeitig (erste richtige gewinnt)',
        rules: [
          'Beide Teams raten gleichzeitig.',
          'Die erste richtige Antwort gewinnt.',
          'Die Teams dürfen beliebig oft raten.',
        ],
      },
    ],
    activeGameshow: 'beispiele',
    gameshows: {
      beispiele: {
        name: 'Beispiele',
        gameOrder: [],
      },
    },
  };
}

/**
 * Load config.json, falling back to the minimal default when the file is
 * missing, encrypted, or unparseable. Returns both the config and a flag
 * indicating whether the fallback was used.
 */
export async function loadConfigWithFallback(
  configPath: string,
): Promise<{ config: AppConfig; isCleanInstall: boolean }> {
  let raw: Buffer;
  try {
    raw = await readFile(configPath);
  } catch {
    return { config: buildDefaultConfig(), isCleanInstall: true };
  }
  if (isGitCryptBlob(raw)) {
    return { config: buildDefaultConfig(), isCleanInstall: true };
  }
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as AppConfig;
    return { config: parsed, isCleanInstall: false };
  } catch {
    return { config: buildDefaultConfig(), isCleanInstall: true };
  }
}

export interface EnsureConfigResult {
  /** What happened to `config.json` on disk. */
  action: 'kept' | 'created-missing' | 'created-encrypted';
  /** Path of the backup written when an encrypted blob was replaced. */
  backupPath?: string;
}

/**
 * Guarantee that `configPath` is a readable plaintext `config.json` on disk.
 *
 * - Missing             → write a template-based default config.
 * - git-crypt blob      → back up the encrypted blob to `<configPath>.git-crypt.bak`
 *                         (only if no backup exists yet), then write the default.
 * - Valid plaintext     → leave untouched.
 * - Malformed plaintext → leave untouched (could be a half-finished hand edit;
 *                         the in-memory fallback in `loadConfigWithFallback` still
 *                         serves it — never destroy the user's on-disk edit).
 *
 * Writes atomically (tmp + rename) with 2-space indent and a trailing newline.
 * See specs/clean-install.md.
 */
export async function ensureConfigFile(
  configPath: string,
): Promise<EnsureConfigResult> {
  let raw: Buffer | null = null;
  try {
    raw = await readFile(configPath);
  } catch {
    raw = null;
  }

  // Any plaintext (valid OR malformed) → don't touch the user's on-disk state.
  if (raw !== null && !isGitCryptBlob(raw)) {
    return { action: 'kept' };
  }

  const encrypted = raw !== null; // reached here only if missing or a git-crypt blob
  let backupPath: string | undefined;
  if (encrypted) {
    // Preserve the encrypted blob so it can be recovered after unlocking
    // git-crypt. Never clobber an existing backup — the first one wins.
    backupPath = `${configPath}.git-crypt.bak`;
    let backupExists = false;
    try {
      await readFile(backupPath);
      backupExists = true;
    } catch {
      backupExists = false;
    }
    if (!backupExists) {
      await rename(configPath, backupPath);
    }
  }

  const config = buildDefaultConfig();
  const tmpPath = `${configPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  await rename(tmpPath, configPath);

  return { action: encrypted ? 'created-encrypted' : 'created-missing', backupPath };
}
