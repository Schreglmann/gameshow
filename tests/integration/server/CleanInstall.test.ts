import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  GIT_CRYPT_MAGIC,
  isGitCryptBlob,
  buildDefaultConfig,
  loadConfigWithFallback,
  ensureConfigFile,
} from '../../../server/clean-install';
import type { AppConfig } from '../../../src/types/config';

/**
 * Verifies the clean-install fallback per specs/clean-install.md.
 *
 * Since templates were removed (see specs/example-games.md), the default config
 * is a single empty "Beispiele" gameshow — the admin "Beispiele erstellen"
 * button / `npm run fixtures` populates it.
 */

describe('clean-install: isGitCryptBlob', () => {
  it('returns true for a buffer starting with the git-crypt magic', () => {
    const buf = Buffer.concat([GIT_CRYPT_MAGIC, Buffer.from('whatever')]);
    expect(isGitCryptBlob(buf)).toBe(true);
  });

  it('returns false for a plaintext JSON buffer', () => {
    expect(isGitCryptBlob(Buffer.from('{"foo":1}'))).toBe(false);
  });

  it('returns false for a too-short buffer', () => {
    expect(isGitCryptBlob(Buffer.from([0x00, 0x47]))).toBe(false);
  });

  it('returns false when the magic appears later in the buffer', () => {
    const buf = Buffer.concat([Buffer.from('lol'), GIT_CRYPT_MAGIC]);
    expect(isGitCryptBlob(buf)).toBe(false);
  });
});

describe('clean-install: buildDefaultConfig', () => {
  it('produces a valid AppConfig with a single empty `beispiele` gameshow', () => {
    const config = buildDefaultConfig();
    expect(config.activeGameshow).toBe('beispiele');
    expect(config.gameshows.beispiele).toBeDefined();
    expect(config.gameshows.beispiele.name).toBe('Beispiele');
    expect(config.gameshows.beispiele.gameOrder).toEqual([]);
    expect(config.pointSystemEnabled).toBe(true);
    expect(config.teamRandomizationEnabled).toBe(true);
    expect(config.globalRules?.length).toBeGreaterThan(0);
    expect(config.rulesPresets?.length).toBeGreaterThan(0);
  });
});

describe('clean-install: loadConfigWithFallback', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'clean-install-'));
    configPath = path.join(tmpDir, 'config.json');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('uses the fallback when config.json is missing', async () => {
    const { config, isCleanInstall } = await loadConfigWithFallback(configPath);
    expect(isCleanInstall).toBe(true);
    expect(config.activeGameshow).toBe('beispiele');
    expect(config.gameshows.beispiele.gameOrder).toEqual([]);
  });

  it('uses the fallback when config.json is a git-crypt blob', async () => {
    await writeFile(configPath, Buffer.concat([GIT_CRYPT_MAGIC, Buffer.from('encrypted-payload')]));
    const { config, isCleanInstall } = await loadConfigWithFallback(configPath);
    expect(isCleanInstall).toBe(true);
    expect(config.activeGameshow).toBe('beispiele');
  });

  it('uses the fallback when config.json contains malformed JSON', async () => {
    await writeFile(configPath, 'this is not json');
    const { config, isCleanInstall } = await loadConfigWithFallback(configPath);
    expect(isCleanInstall).toBe(true);
    expect(config.activeGameshow).toBe('beispiele');
  });

  it('returns the parsed config when config.json is a valid plaintext JSON', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        activeGameshow: 'real',
        gameshows: { real: { name: 'My Show', gameOrder: ['allgemeinwissen/v1'] } },
      }),
    );
    const { config, isCleanInstall } = await loadConfigWithFallback(configPath);
    expect(isCleanInstall).toBe(false);
    expect(config.activeGameshow).toBe('real');
    expect(config.gameshows.real.gameOrder).toEqual(['allgemeinwissen/v1']);
  });
});

describe('clean-install: ensureConfigFile', () => {
  let tmpDir: string;
  let configPath: string;
  let backupPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'clean-install-'));
    configPath = path.join(tmpDir, 'config.json');
    backupPath = `${configPath}.git-crypt.bak`;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a default config.json when the file is missing', async () => {
    const result = await ensureConfigFile(configPath);
    expect(result.action).toBe('created-missing');
    expect(result.backupPath).toBeUndefined();
    expect(existsSync(configPath)).toBe(true);
    const written = await readFile(configPath, 'utf8');
    expect(written.endsWith('\n')).toBe(true); // trailing newline
    const parsed = JSON.parse(written) as AppConfig;
    expect(parsed.activeGameshow).toBe('beispiele');
    expect(parsed.gameshows.beispiele.gameOrder).toEqual([]);
  });

  it('backs up an encrypted blob then writes a default config', async () => {
    const blob = Buffer.concat([GIT_CRYPT_MAGIC, Buffer.from('encrypted-payload')]);
    await writeFile(configPath, blob);

    const result = await ensureConfigFile(configPath);
    expect(result.action).toBe('created-encrypted');
    expect(result.backupPath).toBe(backupPath);

    // Backup holds the original encrypted bytes...
    const backed = await readFile(backupPath);
    expect(backed.equals(blob)).toBe(true);
    // ...and config.json is now valid plaintext default.
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as AppConfig;
    expect(parsed.activeGameshow).toBe('beispiele');
  });

  it('does not clobber an existing backup when run twice', async () => {
    const firstBlob = Buffer.concat([GIT_CRYPT_MAGIC, Buffer.from('original')]);
    await writeFile(configPath, firstBlob);
    await ensureConfigFile(configPath); // creates the backup

    // Simulate config.json reverting to an encrypted blob again (e.g. git reset).
    const secondBlob = Buffer.concat([GIT_CRYPT_MAGIC, Buffer.from('second')]);
    await writeFile(configPath, secondBlob);
    const result = await ensureConfigFile(configPath);

    expect(result.action).toBe('created-encrypted');
    // The first backup is preserved untouched.
    const backed = await readFile(backupPath);
    expect(backed.equals(firstBlob)).toBe(true);
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as AppConfig;
    expect(parsed.activeGameshow).toBe('beispiele');
  });

  it('leaves a valid plaintext config.json untouched', async () => {
    const original = JSON.stringify({
      activeGameshow: 'real',
      gameshows: { real: { name: 'My Show', gameOrder: ['allgemeinwissen/v1'] } },
    });
    await writeFile(configPath, original);
    const result = await ensureConfigFile(configPath);
    expect(result.action).toBe('kept');
    expect(existsSync(backupPath)).toBe(false);
    expect(await readFile(configPath, 'utf8')).toBe(original);
  });

  it('leaves a malformed (non-encrypted) config.json untouched', async () => {
    await writeFile(configPath, 'this is not json');
    const result = await ensureConfigFile(configPath);
    expect(result.action).toBe('kept');
    expect(existsSync(backupPath)).toBe(false);
    expect(await readFile(configPath, 'utf8')).toBe('this is not json');
  });
});
