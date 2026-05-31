import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  GIT_CRYPT_MAGIC,
  isGitCryptBlob,
  buildDefaultGameOrder,
  buildDefaultConfig,
  loadConfigWithFallback,
  configReferencesOnlyTemplates,
  ensureConfigFile,
} from '../../../server/clean-install';
import type { AppConfig } from '../../../src/types/config';

/**
 * Verifies the clean-install fallback per specs/clean-install.md.
 *
 * The setup creates a throwaway `games/` dir with a couple of unencrypted
 * template files, plus an encrypted blob, and points the loader at it.
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

describe('clean-install: buildDefaultGameOrder', () => {
  let tmpDir: string;
  let gamesDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'clean-install-'));
    gamesDir = path.join(tmpDir, 'games');
    await mkdir(gamesDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns multi-instance template references with /template suffix', async () => {
    await writeFile(
      path.join(gamesDir, '_template-simple-quiz.json'),
      JSON.stringify({ type: 'simple-quiz', title: 'X', instances: { template: { questions: [] } } }),
    );
    await writeFile(
      path.join(gamesDir, '_template-quizjagd.json'),
      JSON.stringify({ type: 'quizjagd', title: 'X', instances: { template: { questions: [] } } }),
    );

    const order = await buildDefaultGameOrder(gamesDir);
    expect(order).toEqual([
      '_template-quizjagd/template',
      '_template-simple-quiz/template',
    ]);
  });

  it('skips templates without a `template` instance', async () => {
    await writeFile(
      path.join(gamesDir, '_template-simple-quiz.json'),
      JSON.stringify({ type: 'simple-quiz', title: 'X', instances: { v1: { questions: [] } } }),
    );
    const order = await buildDefaultGameOrder(gamesDir);
    expect(order).toEqual([]);
  });

  it('includes single-instance templates without a slash suffix', async () => {
    await writeFile(
      path.join(gamesDir, '_template-flat.json'),
      JSON.stringify({ type: 'simple-quiz', title: 'X', questions: [] }),
    );
    const order = await buildDefaultGameOrder(gamesDir);
    expect(order).toEqual(['_template-flat']);
  });

  it('skips git-crypt encrypted template blobs', async () => {
    await writeFile(
      path.join(gamesDir, '_template-encrypted.json'),
      Buffer.concat([GIT_CRYPT_MAGIC, Buffer.from('blob')]),
    );
    await writeFile(
      path.join(gamesDir, '_template-real.json'),
      JSON.stringify({ type: 'simple-quiz', title: 'X', instances: { template: { questions: [] } } }),
    );
    const order = await buildDefaultGameOrder(gamesDir);
    expect(order).toEqual(['_template-real/template']);
  });

  it('ignores non-template files', async () => {
    await writeFile(
      path.join(gamesDir, 'real-game.json'),
      JSON.stringify({ type: 'simple-quiz', title: 'X', questions: [] }),
    );
    const order = await buildDefaultGameOrder(gamesDir);
    expect(order).toEqual([]);
  });

  it('returns empty array if games directory is missing', async () => {
    const order = await buildDefaultGameOrder(path.join(tmpDir, 'does-not-exist'));
    expect(order).toEqual([]);
  });
});

describe('clean-install: buildDefaultConfig', () => {
  let tmpDir: string;
  let gamesDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'clean-install-'));
    gamesDir = path.join(tmpDir, 'games');
    await mkdir(gamesDir, { recursive: true });
    await writeFile(
      path.join(gamesDir, '_template-simple-quiz.json'),
      JSON.stringify({ type: 'simple-quiz', title: 'X', instances: { template: { questions: [] } } }),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('produces a valid AppConfig with a single `default` gameshow', async () => {
    const config = await buildDefaultConfig(gamesDir);
    expect(config.activeGameshow).toBe('default');
    expect(config.gameshows.default).toBeDefined();
    expect(config.gameshows.default.name).toBe('Beispiel-Gameshow');
    expect(config.gameshows.default.gameOrder).toEqual(['_template-simple-quiz/template']);
    expect(config.pointSystemEnabled).toBe(true);
    expect(config.teamRandomizationEnabled).toBe(true);
    expect(config.globalRules?.length).toBeGreaterThan(0);
  });
});

describe('clean-install: loadConfigWithFallback', () => {
  let tmpDir: string;
  let gamesDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'clean-install-'));
    gamesDir = path.join(tmpDir, 'games');
    configPath = path.join(tmpDir, 'config.json');
    await mkdir(gamesDir, { recursive: true });
    await writeFile(
      path.join(gamesDir, '_template-simple-quiz.json'),
      JSON.stringify({ type: 'simple-quiz', title: 'X', instances: { template: { questions: [] } } }),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('uses the fallback when config.json is missing', async () => {
    const { config, isCleanInstall } = await loadConfigWithFallback(configPath, gamesDir);
    expect(isCleanInstall).toBe(true);
    expect(config.activeGameshow).toBe('default');
    expect(config.gameshows.default.gameOrder).toContain('_template-simple-quiz/template');
  });

  it('uses the fallback when config.json is a git-crypt blob', async () => {
    await writeFile(configPath, Buffer.concat([GIT_CRYPT_MAGIC, Buffer.from('encrypted-payload')]));
    const { config, isCleanInstall } = await loadConfigWithFallback(configPath, gamesDir);
    expect(isCleanInstall).toBe(true);
    expect(config.activeGameshow).toBe('default');
  });

  it('uses the fallback when config.json contains malformed JSON', async () => {
    await writeFile(configPath, 'this is not json');
    const { config, isCleanInstall } = await loadConfigWithFallback(configPath, gamesDir);
    expect(isCleanInstall).toBe(true);
    expect(config.activeGameshow).toBe('default');
  });

  it('returns the parsed config when config.json is a valid plaintext JSON', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        activeGameshow: 'real',
        gameshows: { real: { name: 'My Show', gameOrder: ['allgemeinwissen/v1'] } },
      }),
    );
    const { config, isCleanInstall } = await loadConfigWithFallback(configPath, gamesDir);
    expect(isCleanInstall).toBe(false);
    expect(config.activeGameshow).toBe('real');
    expect(config.gameshows.real.gameOrder).toEqual(['allgemeinwissen/v1']);
  });
});

describe('clean-install: configReferencesOnlyTemplates', () => {
  const make = (gameOrder: string[]): AppConfig => ({
    activeGameshow: 'default',
    gameshows: { default: { name: 'X', gameOrder } },
  } as AppConfig);

  it('is true when every active gameOrder entry is a template reference', () => {
    expect(configReferencesOnlyTemplates(make(['_template-simple-quiz/template', '_template-quizjagd/template']))).toBe(true);
  });

  it('is false when the active gameOrder mixes in a real game', () => {
    expect(configReferencesOnlyTemplates(make(['_template-simple-quiz/template', 'allgemeinwissen/v1']))).toBe(false);
  });

  it('is false for an empty gameOrder', () => {
    expect(configReferencesOnlyTemplates(make([]))).toBe(false);
  });

  it('is false when the active gameshow is missing', () => {
    expect(configReferencesOnlyTemplates({ activeGameshow: 'nope', gameshows: {} } as AppConfig)).toBe(false);
  });
});

describe('clean-install: ensureConfigFile', () => {
  let tmpDir: string;
  let gamesDir: string;
  let configPath: string;
  let backupPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'clean-install-'));
    gamesDir = path.join(tmpDir, 'games');
    configPath = path.join(tmpDir, 'config.json');
    backupPath = `${configPath}.git-crypt.bak`;
    await mkdir(gamesDir, { recursive: true });
    await writeFile(
      path.join(gamesDir, '_template-simple-quiz.json'),
      JSON.stringify({ type: 'simple-quiz', title: 'X', instances: { template: { questions: [] } } }),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a default config.json when the file is missing', async () => {
    const result = await ensureConfigFile(configPath, gamesDir);
    expect(result.action).toBe('created-missing');
    expect(result.backupPath).toBeUndefined();
    expect(existsSync(configPath)).toBe(true);
    const written = await readFile(configPath, 'utf8');
    expect(written.endsWith('\n')).toBe(true); // trailing newline
    const parsed = JSON.parse(written) as AppConfig;
    expect(parsed.activeGameshow).toBe('default');
    expect(parsed.gameshows.default.gameOrder).toEqual(['_template-simple-quiz/template']);
    // A freshly materialized default still counts as a clean install.
    expect(configReferencesOnlyTemplates(parsed)).toBe(true);
  });

  it('backs up an encrypted blob then writes a default config', async () => {
    const blob = Buffer.concat([GIT_CRYPT_MAGIC, Buffer.from('encrypted-payload')]);
    await writeFile(configPath, blob);

    const result = await ensureConfigFile(configPath, gamesDir);
    expect(result.action).toBe('created-encrypted');
    expect(result.backupPath).toBe(backupPath);

    // Backup holds the original encrypted bytes...
    const backed = await readFile(backupPath);
    expect(backed.equals(blob)).toBe(true);
    // ...and config.json is now valid plaintext default.
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as AppConfig;
    expect(parsed.activeGameshow).toBe('default');
  });

  it('does not clobber an existing backup when run twice', async () => {
    const firstBlob = Buffer.concat([GIT_CRYPT_MAGIC, Buffer.from('original')]);
    await writeFile(configPath, firstBlob);
    await ensureConfigFile(configPath, gamesDir); // creates the backup

    // Simulate config.json reverting to an encrypted blob again (e.g. git reset).
    const secondBlob = Buffer.concat([GIT_CRYPT_MAGIC, Buffer.from('second')]);
    await writeFile(configPath, secondBlob);
    const result = await ensureConfigFile(configPath, gamesDir);

    expect(result.action).toBe('created-encrypted');
    // The first backup is preserved untouched.
    const backed = await readFile(backupPath);
    expect(backed.equals(firstBlob)).toBe(true);
    // config.json is again a valid default.
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as AppConfig;
    expect(parsed.activeGameshow).toBe('default');
  });

  it('leaves a valid plaintext config.json untouched', async () => {
    const original = JSON.stringify({
      activeGameshow: 'real',
      gameshows: { real: { name: 'My Show', gameOrder: ['allgemeinwissen/v1'] } },
    });
    await writeFile(configPath, original);
    const result = await ensureConfigFile(configPath, gamesDir);
    expect(result.action).toBe('kept');
    expect(existsSync(backupPath)).toBe(false);
    expect(await readFile(configPath, 'utf8')).toBe(original);
  });

  it('leaves a malformed (non-encrypted) config.json untouched', async () => {
    await writeFile(configPath, 'this is not json');
    const result = await ensureConfigFile(configPath, gamesDir);
    expect(result.action).toBe('kept');
    expect(existsSync(backupPath)).toBe(false);
    expect(await readFile(configPath, 'utf8')).toBe('this is not json');
  });
});
