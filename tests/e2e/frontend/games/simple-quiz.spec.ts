import { test, expect } from '@playwright/test';

// Spec: specs/games/simple-quiz.md
test.describe('Game type: simple-quiz', () => {
  test.fixme('renders the first question and reveals the answer on phase advance', async () => {
    // TODO: load a gameshow with a simple-quiz game, assert question visible, advance, assert answer visible
  });

  test.fixme('disabled questions are skipped', async () => {
    // TODO
  });

  test.fixme('AwardPoints surfaces after the last question', async () => {
    // TODO
  });
});
