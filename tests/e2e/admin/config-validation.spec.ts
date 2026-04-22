import { test, expect } from '@playwright/test';

// Spec: specs/config-validation.md
test.describe('Config validation', () => {
  test.fixme('malformed config.json rejected with 400', async () => {
    // TODO: PUT invalid shape, expect 400
  });

  test.fixme('old { games: ... } shape rejected', async () => {
    // TODO
  });
});
