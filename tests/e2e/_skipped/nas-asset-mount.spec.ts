import { test } from '@playwright/test';

// Spec: specs/nas-asset-mount.md — requires an actual NAS mount at
// /Volumes/Georg/Gameshow/Assets/. Not reproducible in CI.
test.skip('nas-asset-mount — requires NAS mount, covered by manual testing + unit tests for sync-assets.ts', () => {
  // no-op placeholder
});
