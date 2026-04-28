import { test, expect } from '@playwright/test';

// Spec: specs/games/colorguess.md
test.describe('Game type: colorguess', () => {
  test.fixme('pie chart renders with one wedge per color slice', async () => {
    // TODO: navigate to a colorguess round, assert .color-pie__wedge count matches colors.length
  });

  test.fixme('hovering a wedge shows its hex code', async () => {
    // TODO
  });

  test.fixme('click-to-reveal shows the original image next to the pie chart', async () => {
    // TODO
  });
});
