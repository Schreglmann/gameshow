import { test, expect } from '@playwright/test';

// Live-server sanity checks. The vitest contract suite (tests/contracts/) does
// the deep schema validation — this file just makes sure the dev server that
// Playwright boots actually serves the endpoints the contract documents.

test.describe('Live contract sanity', () => {
  test('GET /api/settings returns the documented shape', async ({ request }) => {
    const res = await request.get('/api/settings');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('pointSystemEnabled');
    expect(data).toHaveProperty('teamRandomizationEnabled');
    expect(data).toHaveProperty('globalRules');
  });

  test('GET /api/theme returns the documented shape', async ({ request }) => {
    const res = await request.get('/api/theme');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('frontend');
    expect(data).toHaveProperty('admin');
  });

  test('GET /api/background-music returns an array', async ({ request }) => {
    const res = await request.get('/api/background-music');
    expect(res.ok()).toBe(true);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test('GET /api/backend/games returns { games }', async ({ request }) => {
    const res = await request.get('/api/backend/games');
    expect(res.ok()).toBe(true);
    const data = await res.json() as { games: unknown };
    expect(Array.isArray(data.games)).toBe(true);
  });

  test('GET /api/backend/config returns AppConfig', async ({ request }) => {
    const res = await request.get('/api/backend/config');
    expect(res.ok()).toBe(true);
    const data = await res.json() as { activeGameshow?: string; gameshows?: unknown };
    expect(typeof data.activeGameshow).toBe('string');
    expect(typeof data.gameshows).toBe('object');
  });

  test('GET /api/backend/system-status returns full shape', async ({ request }) => {
    const res = await request.get('/api/backend/system-status');
    expect(res.ok()).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    for (const key of ['server', 'storage', 'caches', 'processes', 'config', 'nasSync']) {
      expect(data[key], `missing key ${key}`).toBeDefined();
    }
  });
});
