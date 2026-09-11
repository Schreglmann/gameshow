import { test, expect, type Page } from '@playwright/test';
import { isolateShowWsState } from '../_helpers/setup';

// Spec: specs/header.md
test.describe('Header', () => {
  test.fixme('displays game title and team points', async () => {
    // TODO
  });

  test.fixme('joker bar is rendered integrated into header', async () => {
    // TODO: enable jokers in config, assert .joker-bar renders inside .game-header
  });
});

// Spec: specs/header.md ("Side by side"), specs/team-management.md (header name,
// long-name hint). A custom team name of any length must never push a 3-4 team
// side onto a second row — it truncates inside its pill, with the two-digit
// score fully visible — and the hint shown while renaming must agree with what
// the header actually does.
const LONG_NAME = 'Die absolut unbesiegbaren Adler vom Nordhang';
const SHORT_NAME = 'Quizfüchse Süd';

async function pinShow(page: Page, teamCount: number, jokers: string[], team1Name: string) {
  await isolateShowWsState(page);
  await page.route('**/api/settings', async (route) => {
    const resp = await route.fetch();
    const json = await resp.json();
    json.pointSystemEnabled = true;
    json.teamCount = teamCount;
    json.enabledJokers = jokers;
    json.jokersInLastGame = true;
    json.teamRandomizationEnabled = true;
    await route.fulfill({ response: resp, json });
  });
  await page.addInitScript(({ teamCount, team1Name }) => {
    for (let n = 1; n <= 4; n += 1) {
      localStorage.removeItem(`team${n}Name`);
      if (n <= teamCount) {
        localStorage.setItem(`team${n}`, JSON.stringify(['Alice', 'Bob']));
        localStorage.setItem(`team${n}Points`, String(89 - n)); // two digits: 88, 87, 86, 85
      }
    }
    localStorage.setItem('team1Name', team1Name);
  }, { teamCount, team1Name });
}

/** One `y` per stack = every pill of that side on one row. */
async function stackRowCounts(page: Page): Promise<number[]> {
  return page.locator('header .team-header-stack').evaluateAll(stacks =>
    stacks.map(st => new Set(Array.from(st.children).map(c => Math.round(c.getBoundingClientRect().y))).size),
  );
}

test.describe('Header — long team names (3-4 teams)', () => {
  for (const jokers of [[], ['call-friend', 'ask-ai']]) {
    for (const width of [1024, 1440, 1920]) {
      test(`4 teams, ${jokers.length} jokers, ${width}px: a long name truncates instead of wrapping its side`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await pinShow(page, 4, jokers, LONG_NAME);
        await page.goto('/show/game?index=0');
        await expect(page.locator('header .team-header-cell')).toHaveCount(4, { timeout: 10_000 });
        // Let the fitter step the name down and the theme font settle.
        await page.waitForTimeout(500);

        // Both sides on one row each — the default pills fit one row at this
        // width without a custom name, so the custom name must not change that.
        expect(await stackRowCounts(page)).toEqual([1, 1]);

        // The long name is cut (ellipsis), never wrapped or spilling out.
        const name = page.locator('header .team-header-cell[data-team="team1"] .team-header-name');
        expect(await name.evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(true);

        // The two-digit score sits fully inside its pill.
        const inside = await page.locator('header .team-header-cell[data-team="team1"]').evaluate(cell => {
          const c = cell.getBoundingClientRect();
          const s = cell.querySelector('.team-header-score')!.getBoundingClientRect();
          return s.left >= c.left && s.right <= c.right + 0.5 && cell.textContent!.includes('88 Punkte');
        });
        expect(inside).toBe(true);

        // Nothing scrolls sideways.
        expect(await page.locator('header').evaluate(h => h.scrollWidth <= h.clientWidth)).toBe(true);
      });
    }
  }

  test('the rename hint agrees with the header: shown for a name the header cuts, hidden for one it shows in full', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await pinShow(page, 4, [], SHORT_NAME);

    // The header shows the short custom name in full …
    await page.goto('/show/game?index=0');
    const name = page.locator('header .team-header-cell[data-team="team1"] .team-header-name');
    await expect(name).toHaveText(SHORT_NAME, { timeout: 10_000 });
    await page.waitForTimeout(500);
    expect(await name.evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(false);

    // … so renaming to it on the home screen shows no hint, while the long
    // name (cut in the header, see above) does.
    await page.goto('/show/');
    const heading = page.locator('#team1 .team-card-name');
    await expect(heading).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready);
    await heading.click();
    const input = page.locator('#team1 .team-name-edit-input');
    await input.fill(SHORT_NAME);
    await expect(page.locator('#team1 .team-name-hint')).toHaveCount(0);
    await input.fill(LONG_NAME);
    await expect(page.locator('#team1 .team-name-hint')).toBeVisible();
  });
});
