import { test, expect } from '@playwright/test';

// Admin-side responsive coverage. Frontend (show) responsive tests live in
// ../frontend/responsive.spec.ts. Source: previously tests/e2e/responsive.spec.ts.

const PHONE = { width: 375, height: 812 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1440, height: 900 };

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

test.describe('Admin — Responsive Tab Content', () => {
  test('phone: session team grid is single column', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin');
    const grid = page.locator('.session-team-grid');
    await expect(grid).toBeVisible({ timeout: 5000 });
    const style = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns);
    expect(style.split(' ').length).toBe(1);
  });

  test('desktop: session team grid is two columns', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/admin');
    const grid = page.locator('.session-team-grid');
    await expect(grid).toBeVisible({ timeout: 5000 });
    const style = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns);
    expect(style.split(' ').length).toBe(2);
  });

  test('phone: games list hides instances column', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin#games');
    await page.waitForSelector('.games-list-row', { timeout: 10000 });
    const instances = page.locator('.games-list-instances').first();
    await expect(instances).toBeHidden();
  });

  test('desktop: games list shows instances column', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/admin#games');
    await page.waitForSelector('.games-list-row', { timeout: 10000 });
    // Single-instance games render an empty text node ("" after filtering out
    // `template`), which Playwright reports as hidden — so we pick the first
    // span that actually has content rather than blindly taking `.first()`.
    const instances = page.locator('.games-list-instances').filter({ hasText: /.+/ }).first();
    await expect(instances).toBeVisible();
  });
});

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
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
  });
});

test.describe('Admin — Viewport Resize Transitions', () => {
  test('sidebar transitions when resizing phone → desktop', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin');
    await expect(page.locator('.admin-sidebar')).toBeHidden();
    await expect(page.locator('.hamburger-btn')).toBeVisible();

    await page.setViewportSize(DESKTOP);
    await expect(page.locator('.admin-sidebar')).toBeVisible();
    await expect(page.locator('.hamburger-btn')).toBeHidden();
  });

  test('sidebar transitions when resizing desktop → phone', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/admin');
    await expect(page.locator('.admin-sidebar')).toBeVisible();

    await page.setViewportSize(PHONE);
    await expect(page.locator('.admin-sidebar')).toBeHidden();
    await expect(page.locator('.hamburger-btn')).toBeVisible();
  });
});
