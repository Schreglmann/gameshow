import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  GIT_CRYPT_MAGIC,
  isGitCryptBlob,
  buildDefaultGameOrder,
  buildDefaultConfig,
  loadConfigWithFallback,
} from '../../../server/clean-install';

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
