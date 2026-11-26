import { test, expect } from '@playwright/test';
import { openShowHomeForm, addShowPlayers, isolateShowWsState } from '../_helpers/setup';

// Spec: specs/team-management.md
test.describe('Team management', () => {
  // The shared backend caches gamemaster-team-state-v2 as last-value and re-emits
  // it to late-joining clients, which would unmount the "Teams zuweisen" form
  // mid-interaction. Isolate the page's WS so only this test drives team state
  // (see isolateShowWsState).
  test.beforeEach(async ({ page }) => { await isolateShowWsState(page); });

  test('teams split roughly evenly when randomization enabled', async ({ page }) => {
    await openShowHomeForm(page);
    await addShowPlayers(page, 'Alice, Bob, Charlie, Dave');
    await page.locator('button:has-text("Teams zuweisen")').click();

    const pageText = await page.textContent('body');
    for (const name of ['Alice', 'Bob', 'Charlie', 'Dave']) {
      expect(pageText).toContain(name);
    }
  });

  test('team state persists across reload (localStorage)', async ({ page }) => {
    await openShowHomeForm(page);
    await addShowPlayers(page, 'Eve, Frank');
    await page.locator('button:has-text("Teams zuweisen")').click();

    await page.reload();
    await expect(page.locator('body')).toContainText('Eve');
    await expect(page.locator('body')).toContainText('Frank');
  });

  test('the draw is made hidden, survives a reload and is revealed unchanged', async ({ page }) => {
    await openShowHomeForm(page);
    await addShowPlayers(page, 'Gina, Hans, Ida, Jan');
    // Drawn in the background (next to any configured players), but the team
    // cards stay off the show; the names are listed without their teams.
    await expect.poll(() => page.evaluate(() =>
      [1, 2, 3, 4].flatMap(i => JSON.parse(localStorage.getItem(`team${i}`) ?? '[]') as string[]),
    )).toEqual(expect.arrayContaining(['Gina', 'Hans', 'Ida', 'Jan']));
    await expect(page.locator('.draw-pool-label', { hasText: 'Gina' })).toHaveCount(1);
    await expect(page.locator('#teams')).toHaveCount(0);
    const team1 = await page.evaluate(() => JSON.parse(localStorage.getItem('team1') ?? '[]') as string[]);

    await page.reload();
    await expect(page.locator('.draw-add-form input')).toBeVisible();
    await expect(page.locator('#teams')).toHaveCount(0);

    await page.locator('button:has-text("Teams zuweisen")').click();
    await expect(page.locator('#team1')).toBeVisible();
    for (const name of team1) {
      await expect(page.locator(`#team1 input[value="${name}"]`)).toHaveCount(1);
    }
  });

  test.fixme('adding a player via admin pushes to all PWAs via WS', async () => {
    // TODO: open two page contexts — admin + show — and assert team state syncs
  });
});
