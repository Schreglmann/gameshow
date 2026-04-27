import { test, expect } from '@playwright/test';

// Spec: specs/games/image-guess.md
test.describe('Game type: image-guess', () => {
  test.fixme('image renders with the configured obfuscation', async () => {
    // TODO: assert CSS filter matches `blur | pixelate | zoom | swirl | noise | scatter`
  });

  test.fixme('obfuscation eases over duration seconds', async () => {
    // TODO
  });
});
