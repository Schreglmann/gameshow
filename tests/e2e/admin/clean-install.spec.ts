import { test, expect } from '@playwright/test';

// Spec: specs/clean-install.md
test.describe('Clean install', () => {
  test.fixme('GET /api/settings returns isCleanInstall: true when config.json is encrypted', async () => {
    // TODO: this needs a fresh-clone fixture or env override; document the precondition
  });

  test.fixme('Games tab shows only _template-* files in clean-install mode', async () => {
    // TODO
  });
});
