import { test } from '@playwright/test';

// Spec: specs/audio-trim.md — covered via game-type specs
// (frontend/games/audio-guess.spec.ts + frontend/games/bandle.spec.ts)
// where audioStart / audioEnd respect is asserted at the media-element level.
test.skip('audio-trim — covered inside audio-guess and bandle e2e specs', () => {
  // no-op placeholder
});
