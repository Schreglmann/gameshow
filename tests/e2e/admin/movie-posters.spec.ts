import { test, expect } from '@playwright/test';

// Spec: specs/movie-posters.md
test.describe('Movie posters auto-fetch', () => {
  test.fixme('POST /api/backend/assets/videos/fetch-cover downloads a poster', async () => {
    // TODO: mock the external poster-source fetch at the network boundary
  });

  test.fixme('fetched poster appears as the video thumbnail', async () => {
    // TODO
  });
});
