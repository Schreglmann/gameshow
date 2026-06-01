import { test, expect } from '@playwright/test';

// Cross-zone: show ↔ gamemaster full round-trip
test.describe('Show ↔ gamemaster live round-trip', () => {
  test.fixme('show emits gamemaster-answer → gamemaster receives within 500ms', async () => {
    // TODO: use two browser contexts
  });

  test.fixme('gamemaster emits gamemaster-command → show reacts within 500ms', async () => {
    // TODO
  });

  test.fixme('show reload preserves gamemaster view via cached channels', async () => {
    // TODO
  });

  // Regression: with a second show surface left on the start page (/show/),
  // mutating the correct-answers tally on the gamemaster must NOT flip the GM
  // answer card to "Startseite". The fix content-guards the gamemaster-answer
  // emit so the lingering HomeScreen no longer re-broadcasts on unrelated state
  // changes. See specs/cross-device-gamemaster.md.
  test.fixme('adding points with a start-page tab open does not clobber the GM card to "Startseite"', async () => {
    // TODO: open three contexts — /show/ (start page), /show/game (projector),
    // /gamemaster. Click the correct-answers +/− on the GM. Assert the GM card
    // still shows the live answer (no .gamemaster-screen-label === "Startseite").
  });
});
