import { test, expect } from '@playwright/test';

// Spec: specs/games/video-guess.md
test.describe('Game type: video-guess', () => {
  test.fixme('question video segment plays from videoStart to videoQuestionEnd', async () => {
    // TODO
  });

  test.fixme('uses /videos-sdr when HDR, /videos-compressed otherwise', async () => {
    // TODO: intercept video element src, assert URL prefix matches /api/video-hdr response
  });

  test.fixme('stream-notify fires on play, un-fires on pause', async () => {
    // TODO
  });

  test.fixme('audioTrack selects the correct audio stream', async () => {
    // TODO
  });

  test.fixme('locked instance refuses edits', async () => {
    // Covered by admin/video-guess-lock.spec.ts — here we only check the show-side render
  });
});
