import { test, expect } from '@playwright/test';

// Spec: specs/config-system.md
test.describe('Config system', () => {
  test.fixme('changing active gameshow updates /api/settings immediately', async () => {
    // TODO
  });

  test.fixme('global rules persist via PUT /api/backend/config', async () => {
    // TODO
  });
});
