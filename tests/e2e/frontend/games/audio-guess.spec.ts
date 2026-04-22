import { test, expect } from '@playwright/test';

// Spec: specs/games/audio-guess.md
test.describe('Game type: audio-guess', () => {
  test.fixme('audio plays on phase start and respects audioStart/audioEnd markers', async () => {
    // TODO: verify HTMLAudioElement.src, currentTime, and pause at audioEnd
  });

  test.fixme('answer reveal shows answerImage', async () => {
    // TODO
  });

  test.fixme('stream-notify is POSTed when audio plays', async () => {
    // TODO: capture POST /api/backend/stream-notify { active: true }
  });
});
