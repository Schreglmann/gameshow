import type { Locator, Page, Request } from '@playwright/test';
import WebSocket from 'ws';

const WS_URL = (process.env.CONTRACT_TEST_BASE ?? 'http://localhost:3000').replace(/^http/, 'ws') + '/api/ws';

/**
 * Clear the server-side last-value WebSocket cache for the four cached
 * gamemaster channels. Without this, state emitted by one test leaks into
 * the next via the server cache — the worst symptom is UI that mounts
 * with stale teams/controls and detaches DOM mid-click.
 *
 * Use in a `test.beforeEach(() => clearWsState())` of any spec file that
 * interacts with team state, jokers, or gamemaster controls.
 */
export async function clearWsState(): Promise<void> {
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(WS_URL);
    const done = () => { try { ws.close(); } catch { /* noop */ } resolve(); };
    ws.on('open', async () => {
      const channels = [
        'gamemaster-answer',
        'gamemaster-controls',
        'gamemaster-team-state',
        'gamemaster-correct-answers',
      ];
      // Wait for each send to actually flush to the TCP socket before
      // moving on. Without this, the clear may not land before the next
      // test's page opens its own WS and reads the stale cache.
      await Promise.all(
        channels.map((channel) =>
          new Promise<void>((res) => {
            ws.send(JSON.stringify({ channel, data: null }), () => res());
          }),
        ),
      );
      // Extra settle window — the server processes WS messages async,
      // so 100ms is a safety margin before closing.
      setTimeout(done, 100);
    });
    ws.on('error', done);
  });
  // Belt-and-braces: a no-op HTTP round-trip forces the event loop past
  // any queued WS work before Playwright navigates. Cheap and reliable.
  try {
    await fetch((process.env.CONTRACT_TEST_BASE ?? 'http://localhost:3000') + '/api/settings');
  } catch { /* ignore */ }
}

/**
 * Isolate a show page from cross-test team-state leaks.
 *
 * The shared backend caches `gamemaster-team-state` and asks any lingering
 * previous-test show to re-emit its state when a new client connects (see
 * server/ws.ts `sendInitialState` → `show-reemit-request`). Either path delivers
 * a stale team-state burst that flips `hasTeams` true — unmounting the "Teams
 * zuweisen" form (home tests) or overriding seeded points (summary tests). The
 * cold-start gate in GameContext only protects pages booted with empty
 * localStorage, and only against the *first* burst, so `clearWsState()` alone is
 * racy.
 *
 * This intercepts the page's `/api/ws` socket, forwards everything to the real
 * server, but DROPS inbound `gamemaster-team-state` / `gamemaster-correct-answers`
 * frames. Team state then comes solely from this test (the form, or seedTeams()),
 * deterministically. Page→server messages still auto-forward (we don't call
 * `ws.onMessage`); only server→page is filtered. Call BEFORE `page.goto()`.
 */
export async function isolateShowWsState(page: Page): Promise<void> {
  const BLOCKED = new Set(['gamemaster-team-state', 'gamemaster-correct-answers']);
  await page.routeWebSocket(/\/api\/ws/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      try {
        const text = typeof message === 'string' ? message : message.toString('utf-8');
        const channel = (JSON.parse(text) as { channel?: string }).channel;
        if (channel && BLOCKED.has(channel)) return; // drop leaked cross-test state
      } catch {
        /* non-JSON frame — fall through and forward */
      }
      ws.send(message);
    });
  });
}

/**
 * Open the show landing screen and return the team-name textarea, ready to type
 * into. Relies on the spec's `beforeEach(isolateShowWsState)` so no stale
 * team-state burst can unmount the form.
 */
export async function openShowHomeForm(page: Page): Promise<Locator> {
  await page.goto('/show/');
  const textarea = page.locator('.name-form textarea');
  await textarea.waitFor({ state: 'visible', timeout: 10_000 });
  return textarea;
}

/**
 * Seed team state in localStorage before the page navigates. Use when a test
 * depends on teams being present without going through the landing form each
 * time.
 */
export async function seedTeams(
  page: Page,
  opts: {
    team1?: string[];
    team2?: string[];
    team1Points?: number;
    team2Points?: number;
  } = {},
): Promise<void> {
  const team1 = opts.team1 ?? ['Alice'];
  const team2 = opts.team2 ?? ['Bob'];
  await page.addInitScript(
    ({ t1, t2, p1, p2 }) => {
      localStorage.setItem('team1', JSON.stringify(t1));
      localStorage.setItem('team2', JSON.stringify(t2));
      localStorage.setItem('team1Points', String(p1));
      localStorage.setItem('team2Points', String(p2));
    },
    { t1: team1, t2: team2, p1: opts.team1Points ?? 0, p2: opts.team2Points ?? 0 },
  );
}

/** Mobile viewport for responsive checks. */
export const MOBILE_VIEWPORT = { width: 375, height: 812 };
export const TABLET_VIEWPORT = { width: 768, height: 1024 };
export const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
export const PROJECTOR_VIEWPORT = { width: 1920, height: 1080 };

/** Wait for the game container to be visible (marks the game component finished mounting). */
export async function waitForGameReady(page: Page): Promise<void> {
  await page.waitForSelector('.quiz-container', { timeout: 10_000 });
}

/** Capture JSON POST bodies to a named endpoint, for asserting what the client sent. */
export function captureRequests(page: Page, urlSubstring: string): Array<{ method: string; body: unknown }> {
  const captured: Array<{ method: string; body: unknown }> = [];
  page.on('request', (req: Request) => {
    if (!req.url().includes(urlSubstring)) return;
    const postData = req.postData();
    captured.push({
      method: req.method(),
      body: postData ? safeJson(postData) : null,
    });
  });
  return captured;
}

function safeJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}
