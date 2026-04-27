import { test, expect } from '@playwright/test';
import { waitForGameReady } from '../_helpers/setup';

// Spec: specs/keyboard-navigation.md
test.describe('Keyboard navigation', () => {
  test('arrow keys drive game phase transitions', async ({ page }) => {
    await page.goto('/show/game?index=0');
    await waitForGameReady(page);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await expect(page.locator('.quiz-container')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
  });

  test.fixme('Space / Enter triggers primary CTA on landing screen', async () => {
    // TODO
  });
});
