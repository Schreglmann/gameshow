import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { findFreeBasename } from '../../../server/find-free-basename.js';

// `findFreeBasename` powers the collision-avoidance behaviour of the
// download-url endpoint's `desiredName` option. It probes
// `<base><ext>`, `<base> 2<ext>`, … until it finds a name that doesn't exist
// in the given directory. Tested directly so we don't need to boot the server.

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'find-free-basename-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function touch(name: string) {
  mkdirSync(path.dirname(path.join(tmpDir, name)), { recursive: true });
  writeFileSync(path.join(tmpDir, name), '');
}

describe('findFreeBasename', () => {
  it('returns the plain name when no collision exists', () => {
    expect(findFreeBasename(tmpDir, 'Matthew Mercer', '.jpg')).toBe('Matthew Mercer.jpg');
  });

  it('appends " 2" on the first collision', () => {
    touch('Matthew Mercer.jpg');
    expect(findFreeBasename(tmpDir, 'Matthew Mercer', '.jpg')).toBe('Matthew Mercer 2.jpg');
  });

  it('keeps incrementing the suffix until a free name is found', () => {
    touch('Matthew Mercer.jpg');
    touch('Matthew Mercer 2.jpg');
    touch('Matthew Mercer 3.jpg');
    expect(findFreeBasename(tmpDir, 'Matthew Mercer', '.jpg')).toBe('Matthew Mercer 4.jpg');
  });

  it('treats different extensions independently', () => {
    touch('Matthew Mercer.jpg');
    // `.png` doesn't collide with `.jpg`
    expect(findFreeBasename(tmpDir, 'Matthew Mercer', '.png')).toBe('Matthew Mercer.png');
  });

  it('does not actually create the file (caller writes it)', () => {
    findFreeBasename(tmpDir, 'Foo', '.jpg');
    expect(existsSync(path.join(tmpDir, 'Foo.jpg'))).toBe(false);
  });

  it('handles single-word names', () => {
    touch('One.jpg');
    expect(findFreeBasename(tmpDir, 'One', '.jpg')).toBe('One 2.jpg');
  });
});
