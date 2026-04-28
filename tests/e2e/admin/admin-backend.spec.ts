import { test, expect } from '@playwright/test';

// Spec: specs/admin-backend.md
test.describe('Admin backend — CMS tabs', () => {
  test('Games tab lists games via GET /api/backend/games', async ({ request }) => {
    const res = await request.get('/api/backend/games');
    expect(res.ok()).toBe(true);
    const data = await res.json() as { games: unknown[] };
    expect(Array.isArray(data.games)).toBe(true);
  });

  test('Config tab reads via GET /api/backend/config', async ({ request }) => {
    const res = await request.get('/api/backend/config');
    expect(res.ok()).toBe(true);
    const data = await res.json() as { activeGameshow: string };
    expect(typeof data.activeGameshow).toBe('string');
  });

  test.fixme('Assets tab drag & drop upload → assets-changed WS event', async () => {
    // TODO: simulate drag-drop, assert POST /upload, assert WS assets-changed received
  });

  test.fixme('Delete with undo: file moves to .trash, undo restores', async () => {
    // TODO
  });

  test.fixme('Move across categories (audio → background-music) rewrites game refs', async () => {
    // TODO
  });
});
