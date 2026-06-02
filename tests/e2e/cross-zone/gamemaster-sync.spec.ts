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

  // Regression: a running show must never be interrupted by opening another
  // frontend. The newcomer stays inactive (overlay) and emits nothing until the
  // user claims. Prod-only (dev short-circuits useShowPresence). See
  // specs/cross-device-gamemaster.md (server-side liveness check).
  test.fixme('opening a second frontend does not steal the active role from a running show', async () => {
    // TODO (prod build): context A on /show/game becomes active. Open context B
    // on /show/. Assert: B shows the "nicht aktiv" overlay; A stays active; the
    // GM keeps showing A's state; B never emits gamemaster-answer/controls.
  });

  // Reload of the active show resumes control automatically (no manual claim),
  // even with an inactive background frontend open: the reloaded tab sends the
  // same per-tab id, so the server recognises the owner and reclaims its slot;
  // the background frontend (different id) is never promoted.
  test.fixme('reloading the active show auto-resumes control without clicking übernehmen', async () => {
    // TODO (prod build): /show tab A active + background /show tab B (inactive,
    // overlay). Reload A. Assert A is active again (no overlay click), B stays
    // inactive, and the GM keeps mirroring A throughout.
  });
});
