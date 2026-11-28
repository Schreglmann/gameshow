/**
 * Resolves once `GET /api/health` answers 200, polling every `intervalMs`.
 *
 * Used before any automatic page reload: reloading while the server is down
 * lands on the browser's own error page, which only a manual reload gets the
 * show out of. Waiting here keeps the current page (and its state) until a
 * reload can actually succeed. See specs/crash-recovery.md.
 */
export async function waitForServer(intervalMs = 2000): Promise<void> {
  for (;;) {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok) return;
    } catch { /* server unreachable — keep waiting */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
