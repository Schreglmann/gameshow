import { test, expect } from '@playwright/test';

// Spec: specs/dam-image-upscale.md
test.describe('DAM image AI-upscale', () => {
  test('upscale/info endpoint reports availability + model catalog', async ({ request }) => {
    const res = await request.get('/api/backend/assets/images/upscale/info');
    expect(res.ok()).toBe(true);
    const data = await res.json() as {
      available: boolean;
      models: string[];
      scales: number[];
      supportedExts: string[];
    };
    expect(typeof data.available).toBe('boolean');
    expect(data.models).toEqual(['ultramix_balanced', 'ultrasharp', 'digital_art']);
    expect(data.scales).toEqual([2, 4]);
    expect(data.supportedExts).toContain('.jpg');
    expect(data.supportedExts).toContain('.png');
    expect(data.supportedExts).toContain('.webp');
  });

  test.fixme('dryRun on a real image returns a previewUrl + new dims', async () => {
    // TODO: requires a known image fixture + the upscaler binary installed.
  });

  test.fixme('confirm flow replaces bytes + creates backup', async () => {
    // TODO: end-to-end against a fixture image. Verify .replace-backups/ entry exists.
  });

  test.fixme('preview URL 404s after server restart (cache is in-memory only)', async () => {
    // TODO
  });
});
