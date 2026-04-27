import { test } from '@playwright/test';

// Spec: specs/audio-normalization.md — no UI-observable behavior beyond audio loudness.
// Covered by: normalize-audio.ts CLI + manual verification; loudness delta is not
// reliably asserted via Playwright.
test.skip('audio-normalization — ffmpeg-driven loudness pass, tested at the CLI layer', () => {
  // TODO-if-needed: write a unit test asserting normalize.ts produces a file with
  // ffprobe -show_format loudnorm output in the -14 LUFS target band.
});
