import { test, expect } from '@playwright/test';
import { seedTeams } from '../_helpers/setup';

// Spec: specs/point-system.md
test.describe('Point system', () => {
  test('team with more points wins the summary', async ({ page }) => {
    await seedTeams(page, { team1: ['Alice'], team2: ['Bob'], team1Points: 10, team2Points: 5 });
    await page.goto('/show/summary');
    await expect(page.locator('h1')).toContainText('Team 1 hat gewonnen');
  });

  test('equal points yield a tie', async ({ page }) => {
    await seedTeams(page, { team1Points: 5, team2Points: 5 });
    await page.goto('/show/summary');
    await expect(page.locator('h1')).toContainText('Unentschieden');
  });

  test.fixme('point value of each game is currentIndex + 1', async () => {
    // TODO: iterate through games, assert awarded points equal 1-based index
  });
});
