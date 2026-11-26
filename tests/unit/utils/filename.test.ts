import { describe, it, expect } from 'vitest';
import { pastedImageFile, pasteTimestamp, toTitleCaseName } from '@/utils/filename';

describe('toTitleCaseName', () => {
  it('uppercases the first letter of each word', () => {
    expect(toTitleCaseName('matthew mercer')).toBe('Matthew Mercer');
  });

  it('lowercases all-caps input and preserves single spaces', () => {
    expect(toTitleCaseName('MATTHEW MERCER')).toBe('Matthew Mercer');
  });

  it('trims and collapses runs of whitespace', () => {
    expect(toTitleCaseName('  MATTHEW   MERCER  ')).toBe('Matthew Mercer');
  });

  it('handles a single word', () => {
    expect(toTitleCaseName('one')).toBe('One');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(toTitleCaseName('   ')).toBe('');
    expect(toTitleCaseName('')).toBe('');
  });

  it('uppercases Unicode letters (umlauts)', () => {
    expect(toTitleCaseName('mit umlaut äöü')).toBe('Mit Umlaut Äöü');
  });

  it('handles mixed casing input', () => {
    expect(toTitleCaseName('mAtThEw MeRcEr')).toBe('Matthew Mercer');
  });
});

describe('pasteTimestamp', () => {
  it('formats the date without colons or dots', () => {
    expect(pasteTimestamp(new Date('2026-11-26T14:03:07.123Z'))).toBe('2026-11-26T14-03-07');
  });
});

describe('pastedImageFile', () => {
  const TS = '2026-11-26T14-03-07';

  it('renames a pasted image and keeps its extension and type', () => {
    const f = pastedImageFile(new File(['x'], 'image.PNG', { type: 'image/png' }), TS);
    expect(f.name).toBe('pasted-2026-11-26T14-03-07.png');
    expect(f.type).toBe('image/png');
  });

  it('adds an index suffix for the second and later images of one paste', () => {
    expect(pastedImageFile(new File(['x'], 'image.png', { type: 'image/png' }), TS, 2).name)
      .toBe('pasted-2026-11-26T14-03-07-2.png');
  });

  it('derives the extension from the MIME type when the name has none', () => {
    expect(pastedImageFile(new File(['x'], 'blob', { type: 'image/jpeg' }), TS).name).toBe('pasted-2026-11-26T14-03-07.jpeg');
    expect(pastedImageFile(new File(['x'], 'blob', { type: 'image/svg+xml' }), TS).name).toBe('pasted-2026-11-26T14-03-07.svg');
  });
});
