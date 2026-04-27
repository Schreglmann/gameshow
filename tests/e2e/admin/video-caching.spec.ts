import { test, expect } from '@playwright/test';

// Spec: specs/video-caching.md (Planned)
test.describe('Video caching & preview mechanics', () => {
  test.fixme('warm-preview shows every video about to be warmed', async () => {
    // TODO
  });

  test.fixme('cache-started / cache-ready WS events fire during warmup', async () => {
    // TODO
  });

  test.fixme('idle-cancel aborts encoding if preview paused > 10s', async () => {
    // TODO
  });
});
