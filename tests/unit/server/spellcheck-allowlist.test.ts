import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  readConfig,
  setEnabled,
  addWord,
  removeWord,
  addIgnore,
  removeIgnore,
  allowlistPath,
  ALLOWLIST_VERSION,
} from '../../../server/spellcheck-allowlist.js';

describe('spellcheck-allowlist', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'sc-allow-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns a default (disabled) config when the file is missing', async () => {
    const cfg = await readConfig(dir);
    expect(cfg).toEqual({ version: ALLOWLIST_VERSION, enabled: false, allowedWords: [], ignoredMatches: [] });
  });

  it('round-trips the enabled flag and writes a trailing newline', async () => {
    await setEnabled(true, dir);
    expect((await readConfig(dir)).enabled).toBe(true);
    const raw = await readFile(allowlistPath(dir), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    await setEnabled(false, dir);
    expect((await readConfig(dir)).enabled).toBe(false);
  });

  it('dedupes allowed words case-insensitively but stores original casing', async () => {
    await addWord('Aschaffenburg', dir);
    await addWord('aschaffenburg', dir);
    const cfg = await readConfig(dir);
    expect(cfg.allowedWords).toEqual(['Aschaffenburg']);
  });

  it('removes allowed words case-insensitively', async () => {
    await addWord('Bandle', dir);
    await removeWord('bandle', dir);
    expect((await readConfig(dir)).allowedWords).toEqual([]);
  });

  it('adds and removes ignored fingerprints exactly', async () => {
    await addIgnore('RULE_X::müller', dir);
    await addIgnore('RULE_X::müller', dir); // dedupe
    expect((await readConfig(dir)).ignoredMatches).toEqual(['RULE_X::müller']);
    await removeIgnore('RULE_X::müller', dir);
    expect((await readConfig(dir)).ignoredMatches).toEqual([]);
  });

  it('falls back to defaults on a corrupt file and drops non-string entries', async () => {
    await writeFile(allowlistPath(dir), '{ not valid json', 'utf8');
    expect((await readConfig(dir)).enabled).toBe(false);

    await writeFile(
      allowlistPath(dir),
      JSON.stringify({ enabled: true, allowedWords: ['ok', 5, null], ignoredMatches: ['fp', {}] }),
      'utf8',
    );
    const cfg = await readConfig(dir);
    expect(cfg.enabled).toBe(true);
    expect(cfg.allowedWords).toEqual(['ok']);
    expect(cfg.ignoredMatches).toEqual(['fp']);
  });

  it('does not create the file just by reading', async () => {
    await readConfig(dir);
    expect(existsSync(allowlistPath(dir))).toBe(false);
  });
});
