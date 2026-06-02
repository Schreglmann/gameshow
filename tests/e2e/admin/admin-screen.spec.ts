import { test, expect } from '@playwright/test';

// Spec: specs/admin-screen.md
test.describe('Admin screen shell', () => {
  test('loads and shows admin shell', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('.admin-shell')).toBeVisible({ timeout: 10_000 });
  });

  test('can reset team points', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForSelector('.admin-shell', { timeout: 10_000 });
    const pointInputs = page.getByRole('spinbutton');
    await pointInputs.first().fill('10');
    await pointInputs.last().fill('20');
    await page.locator('button:has-text("Punkte zurücksetzen")').click();
    // Reset asks for confirmation via a custom modal (role=alertdialog), not a
    // native browser dialog — confirm by clicking its "Zurücksetzen" button.
    await page.getByRole('alertdialog').getByRole('button', { name: 'Zurücksetzen' }).click();
    await expect(pointInputs.first()).toHaveValue('0');
    await expect(pointInputs.last()).toHaveValue('0');
  });

  test('back link to home is present', async ({ page }) => {
    await page.goto('/admin');
    // Wait for the admin shell to mount before asserting nav link presence;
    // on a cold dev server the React bundle takes a moment to attach.
    await page.waitForSelector('.admin-shell', { timeout: 10_000 });
    await expect(page.locator('a.admin-back-link')).toBeAttached();
  });
});
