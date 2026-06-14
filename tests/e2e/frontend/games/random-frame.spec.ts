import { test } from '@playwright/test';

// Spec: specs/games/random-frame.md
test.describe('Game type: random-frame', () => {
  test.fixme('shows a random frame requested from /api/random-frame', async () => {
    // TODO: intercept the .image-guess-image src, assert it points at /api/random-frame?path=…&seed=…
  });

  test.fixme('reveals the answer text (+ optional answer image) on advance', async () => {
    // TODO
  });

  test.fixme('gamemaster "Neues Bild" re-rolls the frame (seed changes) on show + GM', async () => {
    // TODO: open gamemaster, click regenerate-frame, assert the show frame URL seed changed
  });

  test.fixme('gamemaster previews and re-rolls the NEXT frame while the answer is revealed', async () => {
    // TODO: reveal answer, assert nextAnswer.image present on GM, click "Nächstes Bild"
  });

  test.fixme('respects frameStart/frameEnd bounds in the request URL', async () => {
    // TODO
  });
});
