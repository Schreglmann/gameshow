import { test, expect } from '@playwright/test';

// Spec: specs/cross-device-gamemaster.md
test.describe('Cross-device gamemaster sync', () => {
  test.fixme('two GM tabs see the same state within one WS round-trip', async () => {
    // TODO: open two browser contexts, assert state convergence
  });

  test.fixme('inactive show tab does not emit to cached channels', async () => {
    // TODO
  });

  test.fixme('take-over via show-claim promotes a secondary show to active', async () => {
    // TODO
  });
});
