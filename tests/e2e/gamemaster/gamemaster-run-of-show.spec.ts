import { test, expect } from '@playwright/test';

// Spec: specs/gamemaster-run-of-show.md
test.describe('Gamemaster run-of-show (Ablauf sidebar + jump-to-game)', () => {
  test('the panel lists the framing screens around the active gameshow', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/gamemaster/');

    const panel = page.locator('.gm-runofshow');
    // At ≥1280px the panel lives in the left gutter, always visible.
    await expect(panel).toBeVisible();
    await expect(panel.locator('.gm-runofshow-label').first()).toHaveText('Startseite');
    await expect(panel.locator('.gm-runofshow-label').last()).toHaveText('Zusammenfassung');
    // The permanent panel has no drawer chrome.
    await expect(page.getByRole('button', { name: 'Ablauf' })).toBeHidden();
  });

  test('below 1280px the panel is a drawer behind the Ablauf toggle', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/gamemaster/');

    const panel = page.locator('.gm-runofshow');
    await expect(panel).not.toHaveClass(/gm-runofshow--open/);

    await page.getByRole('button', { name: 'Ablauf' }).click();
    await expect(panel).toHaveClass(/gm-runofshow--open/);

    await page.locator('.gm-runofshow-backdrop').click();
    await expect(panel).not.toHaveClass(/gm-runofshow--open/);
  });

  test('every row is a comfortable touch target', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/gamemaster/');
    await page.getByRole('button', { name: 'Ablauf' }).click();

    const rows = page.locator('.gm-runofshow-row');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const box = await rows.nth(i).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const close = await page.locator('.gm-runofshow-close').boundingBox();
    expect(close!.height).toBeGreaterThanOrEqual(44);
    expect(close!.width).toBeGreaterThanOrEqual(44);
  });

  test.fixme('the gutter panel shows only previous / current / next, centred on the current entry', async () => {
    // TODO: needs an active show at a known game index.
  });

  test.fixme('the highlight follows the show from home through the games to the summary', async () => {
    // TODO: needs a show tab registered as the active frontend (see tests/e2e/cross-zone).
  });

  test.fixme('confirming a jump moves the show to that game and updates the highlight', async () => {
    // TODO
  });

  test.fixme('cancelling the dialog leaves the show where it was', async () => {
    // TODO
  });

  test.fixme('dismissing the dialog by backdrop or Escape does not advance the show', async () => {
    // TODO: the regression this guards — GamemasterScreen's document click/key
    // handlers would otherwise send nav-forward through the overlay.
  });

  test.fixme('a game removed from gameOrder in the admin disappears from the panel live', async () => {
    // TODO: drive via content-changed.
  });

  test.fixme('an unresolvable gameOrder ref renders as a disabled "Fehlt" row', async () => {
    // TODO
  });
});
