import { test, expect } from '@playwright/test';
import { seedTeams, openShowHomeForm, isolateShowWsState } from '../_helpers/setup';

// Spec: specs/app-navigation-flow.md
test.describe('App navigation flow', () => {
  // Isolate from the shared backend's cached/re-emitted team-state so the
  // "Teams zuweisen" form (and seeded summary state) is never clobbered by a
  // stale burst from an earlier test (see isolateShowWsState).
  test.beforeEach(async ({ page }) => { await isolateShowWsState(page); });

  test('landing → rules → game path is reachable', async ({ page }) => {
    const textarea = await openShowHomeForm(page);
    await textarea.fill('Alice, Bob');
    await page.locator('button:has-text("Teams zuweisen")').click();

    // HomeScreen advances on ArrowRight / Space / any click once teams are set.
    // Waiting for React state to flip `hasTeams` → true, then pressing ArrowRight.
    await expect(page.locator('#team1')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/show\/rules/);

    // Wait for the rules screen's keydown listener to attach before pressing
    // ArrowRight again — otherwise the key fires into the previous screen's
    // (just-unmounted) listener and doesn't trigger navigation.
    await expect(page.locator('#globalRulesList')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/show\/game\?index=0/);
  });

  test('summary shows result', async ({ page }) => {
    await seedTeams(page, { team1Points: 10, team2Points: 5 });
    await page.goto('/show/summary');
    await expect(page.locator('#summaryScreen h1')).toBeVisible({ timeout: 10_000 });
  });

  test.fixme('deep link to /game/:index resolves the correct game', async () => {
    // TODO: assert GameFactory mounts the type from /api/game/:index response
  });
});
