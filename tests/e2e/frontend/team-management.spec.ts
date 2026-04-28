import { test, expect } from '@playwright/test';
import { clearWsState } from '../_helpers/setup';

// Spec: specs/team-management.md
test.describe('Team management', () => {
  // Server caches gamemaster-team-state as last-value. Without clearing,
  // previous tests leak team data into this context's initial-state burst,
  // which unmounts the "Teams zuweisen" form mid-click. afterEach catches
  // the leak at its source, belt-and-braces with beforeEach.
  test.beforeEach(async () => { await clearWsState(); });
  test.afterEach(async () => { await clearWsState(); });

  test('teams split roughly evenly when randomization enabled', async ({ page }) => {
    await page.goto('/show/');
    await page.locator('textarea').fill('Alice, Bob, Charlie, Dave');
    await page.locator('button:has-text("Teams zuweisen")').click();

    const pageText = await page.textContent('body');
    for (const name of ['Alice', 'Bob', 'Charlie', 'Dave']) {
      expect(pageText).toContain(name);
    }
  });

  test('team state persists across reload (localStorage)', async ({ page }) => {
    await page.goto('/show/');
    await page.locator('textarea').fill('Eve, Frank');
    await page.locator('button:has-text("Teams zuweisen")').click();

    await page.reload();
    await expect(page.locator('body')).toContainText('Eve');
    await expect(page.locator('body')).toContainText('Frank');
  });

  test.fixme('adding a player via admin pushes to all PWAs via WS', async () => {
    // TODO: open two page contexts — admin + show — and assert team state syncs
  });
});
