import { describe, it, expect } from 'vitest';
import { parseLogSegments, buildTranscriptJson } from '../../../server/whisper-jobs';

describe('parseLogSegments', () => {
  it('parses a fresh-run log with absolute timestamps', () => {
    const log = `
main: processing 'audio.wav' (24000000 samples, 1500.0 sec)...

[00:00:00.000 --> 00:00:04.000]   Hello world
[00:00:04.000 --> 00:00:08.500]   Continuing here
whisper_print_progress_callback: progress = 5
[00:00:08.500 --> 00:00:12.000]   And final
`.trim();
    const segs = parseLogSegments(log);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ fromMs: 0, toMs: 4000, text: 'Hello world' });
    expect(segs[1]).toEqual({ fromMs: 4000, toMs: 8500, text: 'Continuing here' });
    expect(segs[2]).toEqual({ fromMs: 8500, toMs: 12000, text: 'And final' });
  });

  it('respects RESUME OFFSET markers — second-run timestamps get shifted', () => {
    const log = `
[00:00:00.000 --> 00:00:04.000]   First run start
[00:14:23.000 --> 00:14:25.500]   First run end

=== WHISPER RESUME OFFSET 900000 MS ===
[00:00:00.000 --> 00:00:03.000]   Resumed
[00:00:03.000 --> 00:00:07.000]   And keeps going
`.trim();
    const segs = parseLogSegments(log);
    expect(segs).toHaveLength(4);
    // Pre-marker segments stay absolute
    expect(segs[0].fromMs).toBe(0);
    expect(segs[1].fromMs).toBe(14 * 60_000 + 23_000);
    // Post-marker segments are shifted by the marker's offset (900_000 ms = 15:00)
    expect(segs[2]).toEqual({ fromMs: 900_000, toMs: 903_000, text: 'Resumed' });
    expect(segs[3]).toEqual({ fromMs: 903_000, toMs: 907_000, text: 'And keeps going' });
  });

  it('handles multiple sequential resume markers (chained interruptions)', () => {
    const log = `
[00:00:00.000 --> 00:00:05.000]   A
=== WHISPER RESUME OFFSET 60000 MS ===
[00:00:00.000 --> 00:00:05.000]   B
=== WHISPER RESUME OFFSET 120000 MS ===
[00:00:00.000 --> 00:00:05.000]   C
`.trim();
    const segs = parseLogSegments(log);
    expect(segs.map(s => ({ from: s.fromMs, to: s.toMs, text: s.text }))).toEqual([
      { from: 0, to: 5000, text: 'A' },
      { from: 60_000, to: 65_000, text: 'B' },
      { from: 120_000, to: 125_000, text: 'C' },
    ]);
  });

  it('ignores non-segment, non-marker lines', () => {
    const log = [
      'whisper_init_from_file: loading model',
      'main: processing audio',
      'whisper_print_progress_callback: progress = 0',
      '[00:00:00.000 --> 00:00:01.000]   Real',
      'system_info: n_threads = 4',
      '',
    ].join('\n');
    const segs = parseLogSegments(log);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('Real');
  });

  it('returns empty array for a log with no segments', () => {
    expect(parseLogSegments('progress = 5\nprogress = 10')).toEqual([]);
  });

  it('skips malformed timestamp lines without crashing', () => {
    const log = `
[bogus --> nonsense]   skip me
[00:00:01.000 --> 00:00:02.000]   keep me
[--> ]   skip me too
`.trim();
    const segs = parseLogSegments(log);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('keep me');
  });
});

describe('buildTranscriptJson', () => {
  it('produces whisper.cpp-shaped JSON consumable by generate-hp-spells', () => {
    const segs = [
      { fromMs: 0, toMs: 1000, text: 'Hello' },
      { fromMs: 1000, toMs: 2500, text: 'World' },
    ];
    const json = buildTranscriptJson(segs);
    expect(json).toEqual({
      transcription: [
        { offsets: { from: 0, to: 1000 }, text: 'Hello' },
        { offsets: { from: 1000, to: 2500 }, text: 'World' },
      ],
    });
  });

  it('round-trips: parseLogSegments → buildTranscriptJson → matches expected shape', () => {
    const log = `
[00:00:00.000 --> 00:00:01.000]   First
=== WHISPER RESUME OFFSET 60000 MS ===
[00:00:00.000 --> 00:00:02.000]   Second
`.trim();
    const segs = parseLogSegments(log);
    const json = buildTranscriptJson(segs);
    expect(json.transcription).toEqual([
      { offsets: { from: 0, to: 1000 }, text: 'First' },
      { offsets: { from: 60_000, to: 62_000 }, text: 'Second' },
    ]);
  });
});
