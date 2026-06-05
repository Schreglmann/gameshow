import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  readConfig,
  setEnabled,
  setSkipNames,
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

  it('returns a default (disabled, skipNames on) config when the file is missing', async () => {
    const cfg = await readConfig(dir);
    expect(cfg).toEqual({ version: ALLOWLIST_VERSION, enabled: false, skipNames: true, allowedWords: [], ignoredMatches: [] });
  });

  it('round-trips the enabled flag and writes a trailing newline', async () => {
    await setEnabled(true, dir);
    expect((await readConfig(dir)).enabled).toBe(true);
    const raw = await readFile(allowlistPath(dir), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    await setEnabled(false, dir);
    expect((await readConfig(dir)).enabled).toBe(false);
  });

  it('round-trips the skipNames flag (default true) and preserves it across other writes', async () => {
    expect((await readConfig(dir)).skipNames).toBe(true);
    await setSkipNames(false, dir);
    expect((await readConfig(dir)).skipNames).toBe(false);
    await setEnabled(true, dir);                       // unrelated write must not reset skipNames
    expect((await readConfig(dir)).skipNames).toBe(false);
    await setSkipNames(true, dir);
    expect((await readConfig(dir)).skipNames).toBe(true);
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
    expect(cfg.skipNames).toBe(true); // legacy file without the field defaults to true
    expect(cfg.allowedWords).toEqual(['ok']);
    expect(cfg.ignoredMatches).toEqual(['fp']);
  });

  it('does not create the file just by reading', async () => {
    await readConfig(dir);
    expect(existsSync(allowlistPath(dir))).toBe(false);
  });
});
