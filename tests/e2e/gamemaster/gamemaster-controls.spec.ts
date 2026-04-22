import { test, expect } from '@playwright/test';

// Spec: specs/gamemaster-controls.md
test.describe('Gamemaster controls', () => {
  test('gamemaster page loads', async ({ page }) => {
    await page.goto('/gamemaster/');
    await expect(page.locator('body')).toBeVisible();
  });

  test.fixme('controls panel renders buttons pushed by the show via WS', async () => {
    // TODO: boot a show context, trigger controls emit, assert GM receives
  });

  test.fixme('button tap sends gamemaster-command with controlId + timestamp', async () => {
    // TODO: capture WS send payload
  });
});
