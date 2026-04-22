import { test, expect } from '@playwright/test';

// Spec: specs/pwa.md
test.describe('Progressive Web Apps — 3 installable surfaces', () => {
  test('show manifest links correctly', async ({ page }) => {
    const res = await page.request.get('/show/manifest.webmanifest');
    if (res.ok()) {
      const json = await res.json() as { start_url?: string; scope?: string };
      expect(json.start_url).toMatch(/\/show/);
      expect(json.scope).toMatch(/\/show/);
    }
  });

  test.fixme('admin and gamemaster manifests have disjoint scopes', async () => {
    // TODO: fetch all 3 manifests, assert scopes don't overlap
  });

  test.fixme('install button surfaces on Chromium when beforeinstallprompt fires', async () => {
    // TODO
  });
});
