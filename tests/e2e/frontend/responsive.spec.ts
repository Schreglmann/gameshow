import { test, expect } from '@playwright/test';
import { clearWsState, seedTeams } from '../_helpers/setup';

// Frontend (show) responsive coverage. Admin responsive lives in
// ../admin/responsive.spec.ts. Source: previously tests/e2e/responsive.spec.ts.

// Clear the server-side WS cache before AND after each test — tests that
// assign teams leave `gamemaster-team-state` populated, which would cause
// the next test's home screen to mount with teams already set and detach
// the form mid-fill. afterEach catches the leak at its source so the next
// test's beforeEach is free of races with the previous context's teardown.
test.beforeEach(async () => { await clearWsState(); });
test.afterEach(async () => { await clearWsState(); });

const PHONE = { width: 375, height: 812 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1440, height: 900 };

test.describe('Gameshow — Responsive Home Screen', () => {
  // `<header>` is not rendered on the show's landing screen or rules screen
  // (see frontend.tsx: `showHeader={false}` on those routes). Header only
  // mounts for /game and /summary — so the header-visibility assertions run
  // on /show/game?index=0.
  test('phone: header scales down', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/show/game?index=0');
    const header = page.locator('header');
    await expect(header).toBeVisible({ timeout: 10_000 });
    const box = await header.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('phone: team points header is readable', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/show/game?index=0');
    await expect(page.locator('header')).toContainText('Team 1', { timeout: 10_000 });
    await expect(page.locator('header')).toContainText('Team 2');
  });

  test('phone: name form fits within viewport', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/show/');
    await expect(page.locator('.name-form')).toBeVisible({ timeout: 10000 });
    const box = await page.locator('.name-form').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('phone: h1 title is visible and not overflowing', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/show/');
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    const box = await h1.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('tablet: home page renders correctly', async ({ page }) => {
    await page.setViewportSize(TABLET);
    await page.goto('/show/');
    await expect(page.locator('h1')).toContainText('Game Show');
    await expect(page.locator('.name-form')).toBeVisible({ timeout: 10000 });
  });

  test('desktop: home page renders correctly', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/show/');
    await expect(page.locator('h1')).toContainText('Game Show');
    await expect(page.locator('.name-form')).toBeVisible({ timeout: 10000 });
  });

  test('phone: teams stack vertically after assignment', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/show/');
    await page.locator('textarea').fill('Alice, Bob, Charlie, Dave');
    await page.locator('button:has-text("Teams zuweisen")').click();
    await expect(page.locator('#team1')).toBeVisible();
    await expect(page.locator('#team2')).toBeVisible();

    const team1Box = await page.locator('#team1').boundingBox();
    const team2Box = await page.locator('#team2').boundingBox();
    expect(team2Box!.y).toBeGreaterThan(team1Box!.y + team1Box!.height - 5);
  });

  test('desktop: teams are side by side after assignment', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/show/');
    await page.locator('textarea').fill('Alice, Bob, Charlie, Dave');
    await page.locator('button:has-text("Teams zuweisen")').click();
    await expect(page.locator('#team1')).toBeVisible();
    await expect(page.locator('#team2')).toBeVisible();

    const team1Box = await page.locator('#team1').boundingBox();
    const team2Box = await page.locator('#team2').boundingBox();
    expect(Math.abs(team2Box!.y - team1Box!.y)).toBeLessThan(20);
  });
});

test.describe('Gameshow — Responsive Game Screen', () => {
  // Using getBoundingClientRect via evaluate() instead of Playwright's
  // boundingBox() — the latter occasionally returns null during the
  // scaleIn animation on mobile viewports even after toBeVisible passes.
  async function containerRect(page: import('@playwright/test').Page) {
    const container = page.locator('.quiz-container').first();
    await expect(container).toBeVisible({ timeout: 10_000 });
    return container.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
  }

  test('phone: quiz container fits viewport', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/show/game?index=0');
    const box = await containerRect(page);
    expect(box.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('tablet: quiz container fits viewport', async ({ page }) => {
    await page.setViewportSize(TABLET);
    await page.goto('/show/game?index=0');
    const box = await containerRect(page);
    expect(box.width).toBeLessThanOrEqual(TABLET.width);
  });

  test('desktop: quiz container respects max-width', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/show/game?index=0');
    const box = await containerRect(page);
    expect(box.width).toBeLessThanOrEqual(1400);
    // Must not span the full viewport — the max-width caps it below viewport width.
    expect(box.width).toBeLessThan(DESKTOP.width);
  });
});

test.describe('Gameshow — Responsive Summary Screen', () => {
  test('phone: winner announcement fits viewport', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await seedTeams(page, { team1: ['Alice'], team2: ['Bob'], team1Points: 10, team2Points: 5 });
    await page.goto('/show/summary');
    await expect(page.locator('.winner-announcement')).toBeVisible({ timeout: 10000 });
    const box = await page.locator('.winner-announcement').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('desktop: winner announcement is centered', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seedTeams(page, { team1: ['Alice'], team2: ['Bob'], team1Points: 10, team2Points: 5 });
    await page.goto('/show/summary');
    await expect(page.locator('.winner-announcement')).toBeVisible({ timeout: 10000 });
    const box = await page.locator('.winner-announcement').boundingBox();
    expect(box!.x).toBeGreaterThan(50);
  });
});

test.describe('Gameshow — Responsive Music Controls', () => {
  test('phone: music controls are present', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/show/');
    await expect(page.locator('.music-controls')).toBeAttached({ timeout: 10000 });
  });

  test('desktop: music controls are present', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/show/');
    await expect(page.locator('.music-controls')).toBeAttached({ timeout: 10000 });
  });
});
