import { test, expect } from '@playwright/test';

// Spec: specs/whisper-transcription.md
test.describe('Whisper transcription', () => {
  test('whisper/health endpoint returns well-formed status', async ({ request }) => {
    const res = await request.get('/api/backend/assets/videos/whisper/health');
    expect(res.ok()).toBe(true);
    const data = await res.json() as { ok: boolean };
    expect(typeof data.ok).toBe('boolean');
  });

  test.fixme('start a job → status progresses through extracting → transcribing → done', async () => {
    // TODO: mock whisper subprocess at the boundary
  });

  test.fixme('pause / resume / stop lifecycle works', async () => {
    // TODO
  });

  test.fixme('job survives Node restart (persistent jobs.json)', async () => {
    // TODO
  });
});
