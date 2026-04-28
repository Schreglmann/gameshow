import { test, expect } from '@playwright/test';

// Spec: specs/games/four-statements.md
test.describe('Game type: four-statements (clue-based guess)', () => {
  test.fixme('statements reveal one at a time', async () => {
    // TODO
  });

  test.fixme('earlier guess yields more points', async () => {
    // TODO: verify scoring scales with number of revealed clues
  });
});
