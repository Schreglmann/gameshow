import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import type { ChildProcess } from 'child_process';
import {
  FILM_STRIPE_VERSION,
  attachFilmStripes,
  buildFilmStripe,
  createFrameExtractor,
  filmStripeDir,
  filmStripeFrameName,
  filmStripeSlug,
  filmStripeWindow,
  isFilmStripeCurrent,
  boostChroma,
  frameColor,
  readFilmStripe,
  rgbToHex,
  weightedFrameColor,
  sampleTimestamps,
  toFilmStripeData,
  type FilmStripeManifest,
} from '../../../server/film-stripe';

/** A solid-colour JPEG, as the frame extractor would return it. */
function solidFrame(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 18, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
}

const SOURCE = { mtimeMs: 1_700_000_000_000, size: 123_456 };

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), 'film-stripe-')); });
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('paths and sampling', () => {
  it('keeps each video in its own directory under film-stripe/', () => {
    expect(filmStripeDir('/cache', 'Dune.m4v')).toBe(path.join('/cache', 'film-stripe', 'Dune'));
  });

  it('flattens folders and special characters into one safe directory name', () => {
    expect(filmStripeSlug('Harry Potter/Teil 1 & 2.m4v')).toBe('Harry_Potter__Teil_1___2');
    // NFC and NFD spellings of the same name share one cache directory.
    expect(filmStripeSlug('Die Unglaublichen – Ärger.mp4'.normalize('NFC')))
      .toBe(filmStripeSlug('Die Unglaublichen – Ärger.mp4'.normalize('NFD')));
  });

  it('pads still names to two digits', () => {
    expect(filmStripeFrameName(0)).toBe('frame-00.jpg');
    expect(filmStripeFrameName(47)).toBe('frame-47.jpg');
  });

  it('samples the midpoints of equal slices, never the edges', () => {
    expect(sampleTimestamps(0, 100, 4)).toEqual([12.5, 37.5, 62.5, 87.5]);
    const ts = sampleTimestamps(10, 20, 240);
    expect(ts).toHaveLength(240);
    expect(ts[0]!).toBeGreaterThan(10);
    expect(ts[239]!).toBeLessThan(20);
  });

  it('skips the first 3 % and the last 7 % of the runtime', () => {
    expect(filmStripeWindow(1000)).toEqual({ start: 30, end: 930 });
  });
});

describe('colour maths', () => {
  it('formats and clamps hex colours', () => {
    expect(rgbToHex(255, 128, 0)).toBe('#ff8000');
    expect(rgbToHex(-5, 300, 15.6)).toBe('#00ff10');
  });

  const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const pixels = (...runs: Array<[number, [number, number, number]]>) =>
    Uint8Array.from(runs.flatMap(([n, rgb]) => Array.from({ length: n }, () => rgb).flat()));

  it('keeps the hue of a solid frame and only saturates it', async () => {
    const [r, g, b] = channels(await frameColor(await solidFrame(200, 40, 40)));
    // Still a red, and at least as saturated as the source (JPEG is lossy).
    expect(r).toBeGreaterThanOrEqual(190);
    expect(g).toBeLessThanOrEqual(45);
    expect(b).toBeLessThanOrEqual(45);
  });

  it('keeps a grey frame grey', () => {
    expect(weightedFrameColor(pixels([100, [90, 90, 90]]))).toBe('#5a5a5a');
  });

  it('lets a small coloured area win over a large grey one', () => {
    // 10 % saturated orange on 90 % mid grey: a plain average would be a dull
    // grey-brown; the weighted colour stays clearly orange.
    const [r, g, b] = channels(weightedFrameColor(pixels([90, [110, 110, 110]], [10, [240, 120, 20]])));
    expect(r - b).toBeGreaterThan(100);
    expect(r).toBeGreaterThan(g);
  });

  it('raises chroma without leaving the gamut and leaves greys alone', () => {
    const [r, g, b] = boostChroma([150, 110, 90], 1.4);
    expect(r - b).toBeGreaterThan(150 - 90);
    for (const v of [r, g, b]) expect(v).toBeGreaterThanOrEqual(0);
    expect(boostChroma([128, 128, 128], 1.4)).toEqual([128, 128, 128]);
    // Already at the gamut edge: unchanged rather than clipped into another hue.
    expect(boostChroma([255, 0, 0], 1.4)).toEqual([255, 0, 0]);
  });
});

describe('isFilmStripeCurrent', () => {
  const manifest = { version: FILM_STRIPE_VERSION, source: SOURCE } as FilmStripeManifest;

  it('is current when size and mtime match', () => {
    expect(isFilmStripeCurrent(manifest, { ...SOURCE })).toBe(true);
    // File systems round mtimes differently (NAS vs. local copy).
    expect(isFilmStripeCurrent(manifest, { ...SOURCE, mtimeMs: SOURCE.mtimeMs + 900 })).toBe(true);
  });

  it('is outdated when the file was replaced', () => {
    expect(isFilmStripeCurrent(manifest, { ...SOURCE, size: SOURCE.size + 1 })).toBe(false);
    expect(isFilmStripeCurrent(manifest, { ...SOURCE, mtimeMs: SOURCE.mtimeMs + 60_000 })).toBe(false);
  });

  it('counts as current when the source cannot be read', () => {
    expect(isFilmStripeCurrent(manifest, null)).toBe(true);
  });

  it('is outdated when computed with an older method, even when the source cannot be read', () => {
    const old = { ...manifest, version: FILM_STRIPE_VERSION - 1 };
    expect(isFilmStripeCurrent(old, { ...SOURCE })).toBe(false);
    expect(isFilmStripeCurrent(old, null)).toBe(false);
  });
});

describe('readFilmStripe', () => {
  it('returns null when nothing is cached', async () => {
    expect(await readFilmStripe(path.join(tmp, 'missing'))).toBeNull();
  });

  it('returns null for a corrupt or outdated manifest', async () => {
    const dir = path.join(tmp, 'film');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'stripe.json'), '{ not json');
    expect(await readFilmStripe(dir)).toBeNull();

    await writeFile(path.join(dir, 'stripe.json'), JSON.stringify({
      version: FILM_STRIPE_VERSION + 1, colors: ['#000000'], frames: 0, framePositions: [], source: SOURCE,
    }));
    expect(await readFilmStripe(dir)).toBeNull();

    await writeFile(path.join(dir, 'stripe.json'), JSON.stringify({
      version: FILM_STRIPE_VERSION, colors: ['red'], frames: 0, framePositions: [], source: SOURCE,
    }));
    expect(await readFilmStripe(dir)).toBeNull();
  });

  it('still reads a stripe computed with an older method, so the show keeps it', async () => {
    const dir = path.join(tmp, 'old-method');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'stripe.json'), JSON.stringify({
      version: 1, colors: ['#112233'], frames: 0, framePositions: [], source: SOURCE, start: 0, end: 1, createdAt: '',
    }));
    expect((await readFilmStripe(dir))?.colors).toEqual(['#112233']);
  });
});

describe('buildFilmStripe', () => {
  it('writes one colour per sample, every n-th frame as a still, and a manifest', async () => {
    const dir = path.join(tmp, 'film');
    const seen: number[] = [];
    const progress: number[] = [];
    const manifest = await buildFilmStripe({
      dir,
      source: SOURCE,
      duration: 1000,
      columns: 20,
      frameEvery: 5,
      // Red in the first half of the film, blue in the second.
      extractFrame: async t => { seen.push(t); return t < 480 ? solidFrame(220, 20, 20) : solidFrame(20, 20, 220); },
      onProgress: done => progress.push(done),
    });

    expect(seen).toHaveLength(20);
    expect(Math.min(...seen)).toBeGreaterThan(30);
    expect(Math.max(...seen)).toBeLessThan(930);
    expect(progress[progress.length - 1]).toBe(20);

    expect(manifest.colors).toHaveLength(20);
    expect(parseInt(manifest.colors[0]!.slice(1, 3), 16)).toBeGreaterThan(180); // red
    expect(parseInt(manifest.colors[19]!.slice(5, 7), 16)).toBeGreaterThan(180); // blue
    expect(manifest.frames).toBe(4);
    expect(manifest.framePositions).toEqual([0, 5, 10, 15]);
    expect(manifest.source).toEqual(SOURCE);

    const files = (await readdir(dir)).sort();
    expect(files).toEqual(['frame-00.jpg', 'frame-01.jpg', 'frame-02.jpg', 'frame-03.jpg', 'stripe.json']);

    // Round-trips through the reader, and the show gets only what it needs.
    const read = await readFilmStripe(dir);
    expect(read).toEqual(manifest);
    expect(toFilmStripeData(read!)).toEqual({
      colors: manifest.colors, frames: 4, framePositions: [0, 5, 10, 15],
    });
  });

  it('fills an unreadable frame with the colour before it', async () => {
    let call = 0;
    const manifest = await buildFilmStripe({
      dir: path.join(tmp, 'film'),
      source: SOURCE,
      duration: 100,
      columns: 10,
      frameEvery: 5,
      extractFrame: async () => {
        // The pool runs several seeks at once, so pick the failure by call order
        // only for the count — which sample fails does not matter here.
        if (call++ === 3) throw new Error('damaged');
        return solidFrame(10, 200, 10);
      },
    });
    expect(manifest.colors).toHaveLength(10);
    expect(new Set(manifest.colors).size).toBe(1);
  });

  it('fails, and keeps the previous stripe, when too many frames are unreadable', async () => {
    const dir = path.join(tmp, 'film');
    const first = await buildFilmStripe({
      dir, source: SOURCE, duration: 100, columns: 10, frameEvery: 5,
      extractFrame: () => solidFrame(1, 2, 3),
    });

    await expect(buildFilmStripe({
      dir, source: { ...SOURCE, size: 1 }, duration: 100, columns: 10, frameEvery: 5,
      extractFrame: async () => { throw new Error('unreachable'); },
    })).rejects.toThrow(/nicht lesbar/);

    expect(await readFilmStripe(dir)).toEqual(first);
    // No temporary directory is left behind.
    expect((await readdir(tmp)).filter(n => n.includes('.tmp-'))).toEqual([]);
  });

  it('replaces an existing stripe as a whole', async () => {
    const dir = path.join(tmp, 'film');
    await buildFilmStripe({ dir, source: SOURCE, duration: 100, columns: 20, frameEvery: 2, extractFrame: () => solidFrame(1, 2, 3) });
    await buildFilmStripe({ dir, source: SOURCE, duration: 100, columns: 10, frameEvery: 5, extractFrame: () => solidFrame(1, 2, 3) });
    // 10 stills from the first build must not survive next to the 2 of the second.
    expect((await readdir(dir)).filter(f => f.startsWith('frame-'))).toHaveLength(2);
  });

  it('removes the temporary directory of a build that was cut off', async () => {
    const dir = path.join(tmp, 'film');
    const stale = path.join(tmp, 'film.tmp-1-1');
    await mkdir(stale, { recursive: true });
    await writeFile(path.join(stale, 'frame-00.jpg'), 'x');
    await buildFilmStripe({ dir, source: SOURCE, duration: 100, columns: 5, frameEvery: 5, extractFrame: () => solidFrame(9, 9, 9) });
    expect((await readdir(tmp)).sort()).toEqual(['film']);
  });

  it('refuses a film of unknown length', async () => {
    await expect(buildFilmStripe({
      dir: path.join(tmp, 'film'), source: SOURCE, duration: 0, extractFrame: () => solidFrame(0, 0, 0),
    })).rejects.toThrow(/Dauer/);
  });

  it('writes valid JSON with a trailing newline', async () => {
    const dir = path.join(tmp, 'film');
    await buildFilmStripe({ dir, source: SOURCE, duration: 100, columns: 5, frameEvery: 5, extractFrame: () => solidFrame(9, 9, 9) });
    const raw = await readFile(path.join(dir, 'stripe.json'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe('attachFilmStripes', () => {
  const isSafePath = (p: string) => !p.includes('..');

  it('adds the cached stripe to the questions that have one and leaves the rest alone', async () => {
    const cacheBase = path.join(tmp, 'cache');
    await buildFilmStripe({
      dir: filmStripeDir(cacheBase, 'Reihe/Film Eins.mp4'),
      source: SOURCE, duration: 100, columns: 10, frameEvery: 5,
      extractFrame: () => solidFrame(10, 20, 30),
    });

    const questions = [
      { video: '/videos/Reihe/Film Eins.mp4', answer: 'Film Eins' },
      { video: '/videos/Nicht berechnet.mp4', answer: 'Film Zwei' },
      { video: '/videos/../config.json', answer: 'Böse' },
    ];
    const result = await attachFilmStripes(questions, cacheBase, isSafePath);

    expect(result[0]!.answer).toBe('Film Eins');
    expect(result[0]!.stripe?.colors).toHaveLength(10);
    expect(result[0]!.stripe?.frames).toBe(2);
    expect(result[0]!.stripe?.framePositions).toEqual([0, 5]);
    // The bookkeeping (source file, window) stays on the server.
    expect(Object.keys(result[0]!.stripe!).sort()).toEqual(['colors', 'framePositions', 'frames']);

    expect(result[1]).toEqual(questions[1]);
    expect(result[2]).toEqual(questions[2]);
    // The input is not modified.
    expect('stripe' in questions[0]!).toBe(false);
  });
});

describe('createFrameExtractor', () => {
  /** A stand-in for the ffmpeg process: an emitter with a stdout emitter and a kill spy. */
  function fakeProcess() {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: ReturnType<typeof vi.fn> };
    proc.stdout = new EventEmitter();
    proc.kill = vi.fn();
    return proc;
  }

  it('seeks before the input, scales, and resolves with the piped frame', async () => {
    const proc = fakeProcess();
    let args: string[] = [];
    const extract = createFrameExtractor({
      ffmpegBin: 'ffmpeg',
      sourcePath: '/videos/Film.mkv',
      spawnFfmpeg: a => { args = a; return proc as unknown as ChildProcess; },
    });
    const result = extract(61.5);
    proc.stdout.emit('data', Buffer.from('ab'));
    proc.stdout.emit('data', Buffer.from('cd'));
    proc.emit('close', 0);
    expect((await result).toString()).toBe('abcd');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    // Keyframe seek: must come before the input it applies to.
    expect(args.indexOf('-noaccurate_seek')).toBeGreaterThanOrEqual(0);
    expect(args.indexOf('-noaccurate_seek')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('61.500');
    expect(args[args.indexOf('-i') + 1]).toBe('/videos/Film.mkv');
    expect(args[args.indexOf('-vf') + 1]).toBe("scale='min(640,iw)':-2");
  });

  it('tone-maps an HDR source after scaling it down', () => {
    const proc = fakeProcess();
    let args: string[] = [];
    const extract = createFrameExtractor({
      ffmpegBin: 'ffmpeg', sourcePath: '/v.mkv', toneMapFilter: 'tonemap=hable',
      spawnFfmpeg: a => { args = a; return proc as unknown as ChildProcess; },
    });
    void extract(1).catch(() => undefined);
    proc.emit('close', 1);
    expect(args[args.indexOf('-vf') + 1]).toBe("scale='min(640,iw)':-2,tonemap=hable");
  });

  it('rejects on a spawn error instead of leaving it unhandled', async () => {
    const proc = fakeProcess();
    const extract = createFrameExtractor({ ffmpegBin: 'ffmpeg', sourcePath: '/v.mkv', spawnFfmpeg: () => proc as unknown as ChildProcess });
    const result = extract(1);
    proc.emit('error', new Error('ENOENT'));
    await expect(result).rejects.toThrow('ENOENT');
  });

  it('rejects on a non-zero exit and on an empty output', async () => {
    const failing = fakeProcess();
    const extract = createFrameExtractor({ ffmpegBin: 'ffmpeg', sourcePath: '/v.mkv', spawnFfmpeg: () => failing as unknown as ChildProcess });
    const a = extract(1);
    failing.emit('close', 1);
    await expect(a).rejects.toThrow(/exited 1/);

    const empty = fakeProcess();
    const extract2 = createFrameExtractor({ ffmpegBin: 'ffmpeg', sourcePath: '/v.mkv', spawnFfmpeg: () => empty as unknown as ChildProcess });
    const b = extract2(1);
    empty.emit('close', 0);
    await expect(b).rejects.toThrow(/exited 0/);
  });

  it('kills a seek that does not return and rejects', async () => {
    vi.useFakeTimers();
    try {
      const proc = fakeProcess();
      const extract = createFrameExtractor({
        ffmpegBin: 'ffmpeg', sourcePath: '/v.mkv', timeoutMs: 1000,
        spawnFfmpeg: () => proc as unknown as ChildProcess,
      });
      const result = extract(1);
      const assertion = expect(result).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });
});
