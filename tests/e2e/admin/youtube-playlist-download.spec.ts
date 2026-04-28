import { test, expect } from '@playwright/test';

// Spec: specs/youtube-playlist-download.md (Planned)
test.describe('YouTube playlist audio download', () => {
  test.fixme('playlist URL expands into one job with per-track sub-progress', async () => {
    // TODO: assert SSE events carry playlistTitle + trackIndex + trackCount
  });
});
