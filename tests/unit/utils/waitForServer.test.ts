import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForServer } from '@/utils/waitForServer';

// Used before an automatic reload so it never lands on the browser's error page
// while the server is down. See specs/crash-recovery.md.
describe('waitForServer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('polls /api/health until it answers', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await waitForServer(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith('/api/health', { cache: 'no-store' });
  });
});
