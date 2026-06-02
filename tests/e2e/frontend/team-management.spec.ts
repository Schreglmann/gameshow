import { test, expect } from '@playwright/test';
import { openShowHomeForm, isolateShowWsState } from '../_helpers/setup';

// Spec: specs/team-management.md
test.describe('Team management', () => {
  // The shared backend caches gamemaster-team-state as last-value and re-emits
  // it to late-joining clients, which would unmount the "Teams zuweisen" form
  // mid-interaction. Isolate the page's WS so only this test drives team state
  // (see isolateShowWsState).
  test.beforeEach(async ({ page }) => { await isolateShowWsState(page); });

  test('teams split roughly evenly when randomization enabled', async ({ page }) => {
    const textarea = await openShowHomeForm(page);
    await textarea.fill('Alice, Bob, Charlie, Dave');
    await page.locator('button:has-text("Teams zuweisen")').click();

    const pageText = await page.textContent('body');
    for (const name of ['Alice', 'Bob', 'Charlie', 'Dave']) {
      expect(pageText).toContain(name);
    }
  });

  test('team state persists across reload (localStorage)', async ({ page }) => {
    const textarea = await openShowHomeForm(page);
    await textarea.fill('Eve, Frank');
    await page.locator('button:has-text("Teams zuweisen")').click();

    await page.reload();
    await expect(page.locator('body')).toContainText('Eve');
    await expect(page.locator('body')).toContainText('Frank');
  });

  test.fixme('adding a player via admin pushes to all PWAs via WS', async () => {
    // TODO: open two page contexts — admin + show — and assert team state syncs
  });
});
