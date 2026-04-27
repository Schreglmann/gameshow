import { test, expect } from '@playwright/test';

// Spec: specs/themes.md
test.describe('Themes', () => {
  test.fixme('theme selection persists via PUT /api/theme', async () => {
    // TODO: change theme in admin, reload show, assert applied theme class
  });

  test.fixme('per-game theme override applies while that game is active', async () => {
    // TODO
  });
});
