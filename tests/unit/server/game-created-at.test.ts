import { describe, it, expect } from 'vitest';
import { parseGitAddLog } from '../../../server/game-created-at.js';

// Output shape of `git log --reverse --format=%x00%at --name-status -M --diff-filter=AR -- games`.
// See specs/admin-games-list.md.
describe('parseGitAddLog', () => {
  const log = [
    '\u00001700000000',
    '',
    'A\tgames/alpha.json',
    'A\tgames/beta.json',
    '\u00001700000100',
    '',
    'R100\tgames/beta.json\tgames/gamma.json',
    'A\tgames/nested/skip.json',
    'A\tgames/notes.txt',
    '\u00001700000200',
    '',
    'A\tgames/alpha.json',
    'R100\tother/x.json\tgames/delta.json',
  ].join('\n');

  it('maps each top-level game file to the time it was first added', () => {
    const times = parseGitAddLog(log, 'games');
    expect(times.get('alpha')).toBe(1_700_000_000_000);
  });

  it('carries the original add time over a rename', () => {
    const times = parseGitAddLog(log, 'games');
    expect(times.get('gamma')).toBe(1_700_000_000_000);
  });

  it('uses the rename commit for a file renamed in from outside the directory', () => {
    expect(parseGitAddLog(log, 'games').get('delta')).toBe(1_700_000_200_000);
  });

  it('ignores nested paths and non-JSON files', () => {
    const times = parseGitAddLog(log, 'games');
    expect(times.has('nested/skip')).toBe(false);
    expect(times.has('notes')).toBe(false);
  });

  it('returns an empty map for empty output', () => {
    expect(parseGitAddLog('', 'games').size).toBe(0);
  });
});
