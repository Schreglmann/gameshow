import { test, expect } from '@playwright/test';
import { clearWsState, publishTeamState, readCachedTeamState } from '../_helpers/setup';

// Cross-zone: team points must stay consistent between whoever awards them and
// the admin Session tab. Deliberately NOT using isolateShowWsState — the point
// of these tests is the real `gamemaster-team-state` traffic.
//
// Regression from a live show: the Session tab seeded its inputs once at mount
// and re-published that snapshot on every blur, so it displayed the score from
// when it was opened and silently reverted awards on every device.
// See specs/cross-device-gamemaster.md and specs/admin-screen.md.
test.describe('Team-state sync — admin Session tab', () => {
  test.beforeEach(async () => { await clearWsState(); });

  /** The two "Punkte" number inputs, in team order. */
  const pointsInputs = (page: import('@playwright/test').Page) =>
    page.locator('.admin-tab-pane input[type="number"]');

  async function openSessionTab(page: import('@playwright/test').Page) {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Session' }).click();
    await expect(page.getByText('Team Verwaltung')).toBeVisible();
  }

  test('an award made elsewhere shows up in the Session tab without a reload', async ({ page }) => {
    await openSessionTab(page);
    await expect(pointsInputs(page).first()).toHaveValue('0');

    await publishTeamState({
      team1: [], team2: [],
      team1Points: 7, team2Points: 2,
      team1JokersUsed: [], team2JokersUsed: [],
      scoreHistory: [], doubleNextGame: null, rev: 5,
    });

    await expect(pointsInputs(page).first()).toHaveValue('7');
    await expect(pointsInputs(page).nth(1)).toHaveValue('2');
  });

  test('blurring an untouched Session-tab field does not revert those points', async ({ page }) => {
    await openSessionTab(page);

    await publishTeamState({
      team1: [], team2: [],
      team1Points: 7, team2Points: 2,
      team1JokersUsed: [], team2JokersUsed: [],
      scoreHistory: [], doubleNextGame: null, rev: 5,
    });
    await expect(pointsInputs(page).first()).toHaveValue('7');

    // Focus a field and leave it without typing — on the iPad this is what
    // switching back to the gamemaster app does to the focused input.
    await page.getByPlaceholder('Team 1').click();
    await page.getByPlaceholder('Clara, Dave, ...').click();

    await expect(pointsInputs(page).first()).toHaveValue('7');
    // And, more importantly, nothing stale went out to the other devices.
    const cached = await readCachedTeamState();
    expect(cached?.team1Points).toBe(7);
  });

  test('an edit merges onto the current score instead of overwriting it', async ({ page }) => {
    await openSessionTab(page);

    // Team 2 scores while the tab sits open...
    await publishTeamState({
      team1: [], team2: [],
      team1Points: 0, team2Points: 9,
      team1JokersUsed: [], team2JokersUsed: [],
      scoreHistory: [], doubleNextGame: null, rev: 5,
    });
    await expect(pointsInputs(page).nth(1)).toHaveValue('9');

    // ...then the operator corrects team 1 only.
    await pointsInputs(page).first().fill('4');
    await page.getByPlaceholder('Team 1').click();

    await expect(pointsInputs(page).first()).toHaveValue('4');
    await expect(pointsInputs(page).nth(1)).toHaveValue('9');

    const cached = await readCachedTeamState();
    expect(cached?.team1Points).toBe(4);
    expect(cached?.team2Points).toBe(9);
  });

  test('a snapshot older than the cached one is rejected by the server', async () => {
    await publishTeamState({
      team1: [], team2: [],
      team1Points: 12, team2Points: 3,
      team1JokersUsed: [], team2JokersUsed: [],
      scoreHistory: [], doubleNextGame: null, rev: 9,
    });

    // A device that fell behind re-seeding its (older) view must not win.
    await publishTeamState({
      team1: [], team2: [],
      team1Points: 0, team2Points: 0,
      team1JokersUsed: [], team2JokersUsed: [],
      scoreHistory: [], doubleNextGame: null, rev: 4,
    });

    const cached = await readCachedTeamState();
    expect(cached?.team1Points).toBe(12);
    expect(cached?.rev).toBe(9);
  });
});
