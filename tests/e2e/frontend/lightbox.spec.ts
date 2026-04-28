import { test, expect } from '@playwright/test';

// Spec: specs/lightbox.md
test.describe('Lightbox', () => {
  test.fixme('clicking an answer image opens the lightbox overlay', async () => {
    // TODO
  });

  test.fixme('ESC key closes the lightbox', async () => {
    // TODO
  });

  test.fixme('playing a video in lightbox fires stream-notify', async () => {
    // TODO: capture POST /api/backend/stream-notify { active: true }
  });
});
