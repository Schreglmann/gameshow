import { test, expect } from '@playwright/test';

// Spec: specs/video-references.md (Planned)
test.describe('Reference-only videos (symlinks to external sources)', () => {
  test.fixme('browse-reference lists user-filesystem directories', async () => {
    // TODO: assert GET /api/backend/assets/videos/reference-roots returns roots
  });

  test.fixme('add-reference creates a symlink and adds to DAM listing', async () => {
    // TODO
  });

  test.fixme('offline reference shows as dangling in the admin UI', async () => {
    // TODO
  });
});
