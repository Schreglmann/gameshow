import { test, expect } from '@playwright/test';

// Cross-zone: admin uploads an asset, show consumes it
test.describe('Admin upload → show consumes', () => {
  test.fixme('uploading an audio file makes it available to an audio-guess question', async () => {
    // TODO: upload via /api/backend/assets/audio/upload, then create a game that references it
  });

  test.fixme('moving an asset rewrites all game references in place', async () => {
    // TODO
  });
});
