import { test } from '@playwright/test';

// Spec: specs/media-encryption.md — no UI-observable behavior.
// Covered by: `npm test` → media-crypt tests (file-format concern, not UI).
test.skip('media-encryption — file-format concern, covered by unit tests', () => {
  // If this file is removed, the spec loses its e2e placeholder — verify unit coverage
  // still exists in tests/unit before removing.
});
