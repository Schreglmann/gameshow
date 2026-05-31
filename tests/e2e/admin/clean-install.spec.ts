import { test } from '@playwright/test';

// Spec: specs/clean-install.md, specs/example-games.md
test.describe('Clean install', () => {
  test.fixme('GET /api/settings returns isCleanInstall: true when config.json is encrypted', async () => {
    // TODO: this needs a fresh-clone fixture or env override; document the precondition
  });

  test.fixme('Spiele tab shows "Beispiele erstellen" button when no games exist', async () => {
    // TODO: needs a fresh-install fixture (empty games dir). Clicking the button should
    // call POST /api/backend/games/examples and populate the list with beispiel-* games.
  });
});
