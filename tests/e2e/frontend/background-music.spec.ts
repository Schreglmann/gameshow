import { test, expect } from '@playwright/test';

// Spec: specs/background-music.md
test.describe('Background music', () => {
  test('music-controls widget is visible on the home page', async ({ page }) => {
    await page.goto('/show/');
    await expect(page.locator('.music-controls')).toBeVisible({ timeout: 10_000 });
  });

  test.fixme('play / pause / skip / volume controls dispatch commands', async () => {
    // TODO: interact with each control and assert the audio element state changes
  });

  test.fixme('auto-fade on phase transitions', async () => {
    // TODO: navigate between phases, assert volume ramp
  });
});
