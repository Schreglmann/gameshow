import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const gamesDir = join(__dirname, '../../../games');

describe('game JSON files', () => {
  const files = readdirSync(gamesDir).filter((f) => f.endsWith('.json'));

  it.each(files)('%s ends with a trailing newline', (file) => {
    const content = readFileSync(join(gamesDir, file));
    expect(content[content.length - 1]).toBe(0x0a); // 0x0a = '\n'
  });
});
