import { test, expect } from '@playwright/test';
import { waitForGameReady } from '../_helpers/setup';

// Spec: specs/base-game-wrapper.md
test.describe('Base game wrapper — shared shell', () => {
  test('renders landing → rules → game → points phases', async ({ page }) => {
    await page.goto('/show/game?index=0');
    await waitForGameReady(page);

    // Landing visible
    await expect(page.locator('.quiz-container')).toBeVisible();

    // Arrow-right advances phases
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
  });

  test.fixme('AwardPoints surfaces after game completes', async () => {
    // TODO: complete a simple-quiz game, assert AwardPoints modal appears
  });
});
