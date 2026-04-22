import { test, expect } from '@playwright/test';

// Spec: specs/header.md
test.describe('Header', () => {
  test.fixme('displays game title and team points', async () => {
    // TODO
  });

  test.fixme('joker bar is rendered integrated into header', async () => {
    // TODO: enable jokers in config, assert .joker-bar renders inside .game-header
  });
});
