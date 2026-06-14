import { test, expect } from '@playwright/test';

// Spec: specs/games/wer-kennt-mehr.md
test.describe('Game type: wer-kennt-mehr (name-more duel, final game)', () => {
  test.fixme('reveals the examples as a compact grid for answerList questions', async () => {
    // TODO
    expect(true).toBe(true);
  });

  test.fixme('entering a count + selecting the winning team awards that many points', async () => {
    // TODO
  });

  test.fixme('selecting both teams splits the points (tie)', async () => {
    // TODO
  });
});
