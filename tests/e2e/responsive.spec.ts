import { test, expect } from '@playwright/test';

// ═══════════════════════════════════════════
//  Responsive Layout Tests
// ═══════════════════════════════════════════

const PHONE = { width: 375, height: 812 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1440, height: 900 };

// ── Admin Shell: Sidebar & Hamburger ──

test.describe('Admin — Responsive Sidebar', () => {
  test('desktop: sidebar is visible, hamburger is hidden', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/admin');
    await expect(page.locator('.admin-sidebar')).toBeVisible();
    await expect(page.locator('.hamburger-btn')).toBeHidden();
  });

  test('phone: sidebar is hidden, hamburger is visible', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin');
    await expect(page.locator('.admin-sidebar')).toBeHidden();
    await expect(page.locator('.hamburger-btn')).toBeVisible();
  });

  test('tablet: sidebar is hidden, hamburger is visible', async ({ page }) => {
    await page.setViewportSize(TABLET);
    await page.goto('/admin');
    await expect(page.locator('.admin-sidebar')).toBeHidden();
    await expect(page.locator('.hamburger-btn')).toBeVisible();
  });

  test('phone: hamburger opens sidebar drawer', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin');
    await page.locator('.hamburger-btn').click();
    await expect(page.locator('.admin-sidebar')).toBeVisible();
    await expect(page.locator('.admin-sidebar')).toHaveClass(/open/);
  });

  test('phone: backdrop click closes sidebar', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin');
    await page.locator('.hamburger-btn').click();
    await expect(page.locator('.admin-sidebar')).toBeVisible();
    await page.locator('.sidebar-backdrop').click({ force: true });
    await expect(page.locator('.admin-sidebar')).toBeHidden();
  });

  test('phone: nav item click closes sidebar and switches tab', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin');
    await page.locator('.hamburger-btn').click();
    await page.getByRole('button', { name: /Spiele/ }).click();
    await expect(page.locator('.admin-sidebar')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Spiele' })).toBeVisible({ timeout: 5000 });
  });

  test('desktop: sidebar shows all nav items with labels', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/admin');
    await expect(page.getByRole('button', { name: /Session/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Spiele/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Config/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Assets/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /System/ })).toBeVisible();
  });

  test('desktop: Home nav link is hidden', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/admin');
    const homeNavLink = page.locator('.admin-nav-home');
    await expect(homeNavLink).toBeHidden();
  });

  test('phone: Home nav link is visible in drawer', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin');
    await page.locator('.hamburger-btn').click();
    await expect(page.locator('.admin-nav-home')).toBeVisible();
  });
});

// ── Admin Tab Content ──

test.describe('Admin — Responsive Tab Content', () => {
  test('phone: session team grid is single column', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin');
    const grid = page.locator('.session-team-grid');
    await expect(grid).toBeVisible({ timeout: 5000 });
    const style = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns);
    // Single column means one value (e.g., "335px")
    expect(style.split(' ').length).toBe(1);
  });

  test('desktop: session team grid is two columns', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/admin');
    const grid = page.locator('.session-team-grid');
    await expect(grid).toBeVisible({ timeout: 5000 });
    const style = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns);
    // Two columns means two values (e.g., "600px 600px")
    expect(style.split(' ').length).toBe(2);
  });

  test('phone: games list hides instances column', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin#games');
    // Wait for games to load
    await page.waitForSelector('.games-list-row', { timeout: 10000 });
    const instances = page.locator('.games-list-instances').first();
    await expect(instances).toBeHidden();
  });

  test('desktop: games list shows instances column', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/admin#games');
    await page.waitForSelector('.games-list-row', { timeout: 10000 });
    const instances = page.locator('.games-list-instances').first();
    await expect(instances).toBeVisible();
  });
});

// ── Admin Modals ──

test.describe('Admin — Responsive Modals', () => {
  test('phone: new game modal fits viewport', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin#games');
    await page.waitForSelector('.tab-toolbar', { timeout: 10000 });
    await page.locator('button:has-text("Neues Spiel")').click();
    const modal = page.locator('.modal-box');
    await expect(modal).toBeVisible();
    const box = await modal.boundingBox();
    expect(box).toBeTruthy();
    // Modal should not exceed viewport width
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
  });
});

// ── Gameshow Player-Facing ──

test.describe('Gameshow — Responsive Home Screen', () => {
  test('phone: header scales down', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    const header = page.locator('header');
    await expect(header).toBeVisible();
    const box = await header.boundingBox();
    // Header should fit within phone width
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('phone: team points header is readable', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await expect(page.locator('header')).toContainText('Team 1');
    await expect(page.locator('header')).toContainText('Team 2');
  });

  test('phone: name form fits within viewport', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await expect(page.locator('.name-form')).toBeVisible({ timeout: 10000 });
    const box = await page.locator('.name-form').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('phone: h1 title is visible and not overflowing', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    const box = await h1.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('tablet: home page renders correctly', async ({ page }) => {
    await page.setViewportSize(TABLET);
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Game Show');
    await expect(page.locator('.name-form')).toBeVisible({ timeout: 10000 });
  });

  test('desktop: home page renders correctly', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Game Show');
    await expect(page.locator('.name-form')).toBeVisible({ timeout: 10000 });
  });

  test('phone: teams stack vertically after assignment', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await page.locator('textarea').fill('Alice, Bob, Charlie, Dave');
    await page.locator('button:has-text("Teams zuweisen")').click();
    await expect(page.locator('#team1')).toBeVisible();
    await expect(page.locator('#team2')).toBeVisible();

    // Teams should be stacked (team2 below team1)
    const team1Box = await page.locator('#team1').boundingBox();
    const team2Box = await page.locator('#team2').boundingBox();
    expect(team1Box).toBeTruthy();
    expect(team2Box).toBeTruthy();
    // team2 top should be below team1 bottom (stacked)
    expect(team2Box!.y).toBeGreaterThan(team1Box!.y + team1Box!.height - 5);
  });

  test('desktop: teams are side by side after assignment', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    await page.locator('textarea').fill('Alice, Bob, Charlie, Dave');
    await page.locator('button:has-text("Teams zuweisen")').click();
    await expect(page.locator('#team1')).toBeVisible();
    await expect(page.locator('#team2')).toBeVisible();

    // Teams should be side by side (same Y position approximately)
    const team1Box = await page.locator('#team1').boundingBox();
    const team2Box = await page.locator('#team2').boundingBox();
    expect(team1Box).toBeTruthy();
    expect(team2Box).toBeTruthy();
    // team2 should be roughly at the same vertical position as team1
    expect(Math.abs(team2Box!.y - team1Box!.y)).toBeLessThan(20);
  });
});

test.describe('Gameshow — Responsive Game Screen', () => {
  test('phone: quiz container fits viewport', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/game?index=0');
    await page.waitForSelector('.quiz-container', { timeout: 10000 });
    const box = await page.locator('.quiz-container').boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('tablet: quiz container fits viewport', async ({ page }) => {
    await page.setViewportSize(TABLET);
    await page.goto('/game?index=0');
    await page.waitForSelector('.quiz-container', { timeout: 10000 });
    const box = await page.locator('.quiz-container').boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual(TABLET.width);
  });

  test('desktop: quiz container is centered with max-width', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/game?index=0');
    await page.waitForSelector('.quiz-container', { timeout: 10000 });
    const box = await page.locator('.quiz-container').boundingBox();
    expect(box).toBeTruthy();
    // Should be centered (left margin > 0)
    expect(box!.x).toBeGreaterThan(0);
    // Should not exceed max-width 1400px
    expect(box!.width).toBeLessThanOrEqual(1400);
  });
});

test.describe('Gameshow — Responsive Summary Screen', () => {
  test('phone: winner announcement fits viewport', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.evaluate(() => {
      localStorage.setItem('team1Points', '10');
      localStorage.setItem('team2Points', '5');
      localStorage.setItem('team1', JSON.stringify(['Alice']));
      localStorage.setItem('team2', JSON.stringify(['Bob']));
    });
    await page.goto('/summary');
    await expect(page.locator('.winner-announcement')).toBeVisible({ timeout: 10000 });
    const box = await page.locator('.winner-announcement').boundingBox();
    expect(box).toBeTruthy();
    // Should not exceed viewport width
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('desktop: winner announcement is centered', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.evaluate(() => {
      localStorage.setItem('team1Points', '10');
      localStorage.setItem('team2Points', '5');
      localStorage.setItem('team1', JSON.stringify(['Alice']));
      localStorage.setItem('team2', JSON.stringify(['Bob']));
    });
    await page.goto('/summary');
    await expect(page.locator('.winner-announcement')).toBeVisible({ timeout: 10000 });
    const box = await page.locator('.winner-announcement').boundingBox();
    expect(box).toBeTruthy();
    // Should be centered (left margin > 0)
    expect(box!.x).toBeGreaterThan(50);
  });
});

// ── Music Controls ──

test.describe('Gameshow — Responsive Music Controls', () => {
  test('phone: music controls are present', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await expect(page.locator('.music-controls')).toBeAttached({ timeout: 10000 });
  });

  test('desktop: music controls are present', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    await expect(page.locator('.music-controls')).toBeAttached({ timeout: 10000 });
  });
});

// ── Viewport Transition ──

test.describe('Responsive — Viewport Resize', () => {
  test('admin sidebar transitions correctly when resizing from phone to desktop', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin');
    // Sidebar hidden on phone
    await expect(page.locator('.admin-sidebar')).toBeHidden();
    await expect(page.locator('.hamburger-btn')).toBeVisible();

    // Resize to desktop
    await page.setViewportSize(DESKTOP);
    // Sidebar should now be visible
    await expect(page.locator('.admin-sidebar')).toBeVisible();
    await expect(page.locator('.hamburger-btn')).toBeHidden();
  });

  test('admin sidebar transitions correctly when resizing from desktop to phone', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/admin');
    await expect(page.locator('.admin-sidebar')).toBeVisible();

    // Resize to phone
    await page.setViewportSize(PHONE);
    await expect(page.locator('.admin-sidebar')).toBeHidden();
    await expect(page.locator('.hamburger-btn')).toBeVisible();
  });
});
