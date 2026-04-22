import { test, expect } from '@playwright/test';

// Spec: specs/youtube-download.md
test.describe('YouTube audio download', () => {
  test.fixme('POST /api/backend/assets/audio/youtube-download streams SSE progress', async () => {
    // TODO: mock yt-dlp subprocess at the boundary; assert SSE `phase` values progress
  });

  test.fixme('cancel mid-download removes the partial file', async () => {
    // TODO
  });
});
