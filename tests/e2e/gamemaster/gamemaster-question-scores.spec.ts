import { test } from '@playwright/test';

// Spec: specs/gamemaster-question-scores.md
test.describe('Gamemaster per-question scoring breakdown', () => {
  test.fixme('a skipped question shows as "keine Wertung" and can be corrected from the panel', async () => {
    // TODO
  });

  test.fixme('a later corrected row stays visible after navigating back', async () => {
    // TODO
  });

  test.fixme('an inline-scored game shows net signed points per question, read-only', async () => {
    // TODO
  });

  test.fixme('a positional award lands in the Gesamt row, not on the last question', async () => {
    // TODO
  });

  test.fixme('the panel survives a gamemaster reload (cached channels)', async () => {
    // TODO
  });
});
