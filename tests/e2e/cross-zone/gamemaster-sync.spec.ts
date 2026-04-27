import { test, expect } from '@playwright/test';

// Cross-zone: show ↔ gamemaster full round-trip
test.describe('Show ↔ gamemaster live round-trip', () => {
  test.fixme('show emits gamemaster-answer → gamemaster receives within 500ms', async () => {
    // TODO: use two browser contexts
  });

  test.fixme('gamemaster emits gamemaster-command → show reacts within 500ms', async () => {
    // TODO
  });

  test.fixme('show reload preserves gamemaster view via cached channels', async () => {
    // TODO
  });
});
