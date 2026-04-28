import { test, expect } from '@playwright/test';
import { clearWsState, seedTeams } from '../_helpers/setup';

// Spec: specs/app-navigation-flow.md
test.describe('App navigation flow', () => {
  // Clear cached gamemaster-team-state so "Teams zuweisen" form renders
  // predictably (see team-management.spec.ts for the rationale).
  test.beforeEach(async () => { await clearWsState(); });
  test.afterEach(async () => { await clearWsState(); });

  test('landing → rules → game path is reachable', async ({ page }) => {
    await page.goto('/show/');
    await page.locator('textarea').fill('Alice, Bob');
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
