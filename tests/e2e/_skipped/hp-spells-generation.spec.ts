import { test } from '@playwright/test';

// Spec: specs/hp-spells-generation.md — pure content-generation script
// (`npm run generate:hp-spells`). No UI surface.
test.skip('hp-spells-generation — CLI script, not an interactive surface', () => {
  // TODO-if-needed: add a unit test asserting the generator produces a valid
  // game file for `simple-quiz` shape.
});
