import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Tests share one backend process whose WebSocket layer caches last-value
  // state (`gamemaster-answer / controls / team-state / correct-answers`).
  // Running multiple workers in parallel means concurrent tests see each
  // other's emits and detach DOM mid-interaction. Keep workers = 1 until the
  // server grows a "test session" isolation mode (separate WS cache per
  // session).
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Start dev server before running e2e tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
