import { test, expect } from '@playwright/test';

// Spec: specs/admin-system-status.md
test.describe('Admin system status', () => {
  test('GET /api/backend/system-status returns expected shape', async ({ request }) => {
    const res = await request.get('/api/backend/system-status');
    expect(res.ok()).toBe(true);
    const data = await res.json() as { server: unknown; storage: unknown; caches: unknown; processes: unknown };
    expect(data.server).toBeDefined();
    expect(data.storage).toBeDefined();
    expect(data.caches).toBeDefined();
    expect(data.processes).toBeDefined();
  });

  test.fixme('System Status tab renders live WS updates every 2s', async () => {
    // TODO: open admin, wait 5s, assert uptime value changed
  });
});
