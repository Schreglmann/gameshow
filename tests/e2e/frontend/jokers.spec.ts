import { test, expect } from '@playwright/test';

// Spec: specs/jokers.md
test.describe('Jokers', () => {
  test.fixme('enabled jokers render in the joker bar', async () => {
    // TODO: enable a joker in config, assert it appears per team
  });

  test.fixme('clicking a joker toggles used state (localStorage + WS)', async () => {
    // TODO
  });

  test.fixme('used joker persists across reload', async () => {
    // TODO
  });
});
