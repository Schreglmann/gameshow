import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { loadShowPresence, saveShowPresence } from '../../../server/ws.js';

// `.show-presence.json` keeps the main show tab's id across a server restart.
// See specs/crash-recovery.md.
describe('show presence sidecar', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'show-presence-'));
    file = path.join(dir, '.show-presence.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips the owner id', () => {
    saveShowPresence(file, 'tab-123');
    expect(loadShowPresence(file)).toBe('tab-123');
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('returns null for a missing file', () => {
    expect(loadShowPresence(file)).toBeNull();
  });

  it('returns null for a malformed file or an empty id', () => {
    writeFileSync(file, '{not json');
    expect(loadShowPresence(file)).toBeNull();
    writeFileSync(file, JSON.stringify({ activeShowId: '' }));
    expect(loadShowPresence(file)).toBeNull();
    writeFileSync(file, JSON.stringify({ activeShowId: 42 }));
    expect(loadShowPresence(file)).toBeNull();
  });

  it('a cleared owner reads back as null', () => {
    saveShowPresence(file, 'tab-123');
    saveShowPresence(file, null);
    expect(loadShowPresence(file)).toBeNull();
  });

  it('never throws when the folder is not writable', () => {
    expect(() => saveShowPresence(path.join(dir, 'missing', 'x.json'), 'a')).not.toThrow();
  });
});
