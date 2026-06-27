import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { isGitCryptBlob } from '../../../server/clean-install';

const gamesDir = join(__dirname, '../../../games');

describe('game JSON files', () => {
  // git-crypt-locked checkouts (CI, remote sessions) see ciphertext for
  // games/*.json — only the decrypted files can be validated.
  const files = readdirSync(gamesDir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !isGitCryptBlob(readFileSync(join(gamesDir, f))));

  if (files.length === 0) {
    it('skipped — all game files are git-crypt encrypted in this checkout', () => {
      expect(files).toEqual([]);
    });
  } else {
    it.each(files)('%s ends with a trailing newline', (file) => {
      const content = readFileSync(join(gamesDir, file));
      expect(content[content.length - 1]).toBe(0x0a); // 0x0a = '\n'
    });
  }
});
