/**
 * Example-game media generation — fully self-synthesized, copyright-free.
 *
 * Nothing is downloaded and nothing binary is committed. Images are drawn from
 * SVG via `sharp`; audio is rendered by a tiny in-code synth (sine + harmonics
 * + ADSR) of **public-domain classical compositions** (Beethoven, Mozart) and
 * encoded to MP3 via the bundled `ffmpeg-static` binary. The compositions are
 * public domain; the performances are our own — so the output is unrestricted.
 *
 * Used by server/example-games.ts (`materializeExamples`). See specs/example-games.md.
 */

import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';

// ── Media item model ──

export type FlagName = 'de' | 'fr' | 'jp' | 'it' | 'nl';
export type GradientName = 'sunset' | 'forest' | 'ocean';
export type IllustrationName = 'apple' | 'house' | 'sailboat';
export type TuneName = 'fuer-elise' | 'ode-to-joy' | 'eine-kleine';

export type ImageSpec =
  | { kind: 'flag'; flag: FlagName }
  | { kind: 'gradient'; gradient: GradientName }
  | { kind: 'illustration'; illustration: IllustrationName };

export type AudioSpec =
  | { kind: 'melody'; tune: TuneName }
  | { kind: 'layer'; tune: TuneName; layer: 'bass' | 'melody' | 'full' };

/** `dest` is the path relative to `local-assets/`, e.g. `images/Beispiele/bild-apfel.png`. */
export type MediaItem =
  | { type: 'image'; dest: string; spec: ImageSpec }
  | { type: 'audio'; dest: string; spec: AudioSpec };

// ── Images (SVG → PNG via sharp) ──

const FLAG_SVGS: Record<FlagName, string> = {
  // Horizontal thirds: black / red / gold
  de: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="66.7" y="0" fill="#000000"/><rect width="300" height="66.7" y="66.7" fill="#DD0000"/><rect width="300" height="66.6" y="133.4" fill="#FFCE00"/></svg>`,
  // Vertical thirds: blue / white / red
  fr: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="100" height="200" x="0" fill="#0055A4"/><rect width="100" height="200" x="100" fill="#FFFFFF"/><rect width="100" height="200" x="200" fill="#EF4135"/></svg>`,
  // White field with a red disc
  jp: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#FFFFFF"/><circle cx="150" cy="100" r="60" fill="#BC002D"/></svg>`,
  // Vertical thirds: green / white / red
  it: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="100" height="200" x="0" fill="#009246"/><rect width="100" height="200" x="100" fill="#FFFFFF"/><rect width="100" height="200" x="200" fill="#CE2B37"/></svg>`,
  // Horizontal thirds: red / white / blue
  nl: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="66.7" y="0" fill="#AE1C28"/><rect width="300" height="66.7" y="66.7" fill="#FFFFFF"/><rect width="300" height="66.6" y="133.4" fill="#21468B"/></svg>`,
};

const GRADIENT_STOPS: Record<GradientName, string[]> = {
  sunset: ['#FF512F', '#DD2476', '#4A148C'],
  forest: ['#1B5E20', '#66BB6A', '#A5D6A7'],
  ocean: ['#003973', '#0277BD', '#4FC3F7'],
};

function gradientSvg(stops: string[]): string {
  const offsets = stops.map((c, i) => `<stop offset="${Math.round((i / (stops.length - 1)) * 100)}%" stop-color="${c}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${offsets}</linearGradient></defs><rect width="300" height="200" fill="url(#g)"/></svg>`;
}

// Recognizable single-subject scenes for the image-guess example. Unlike flags
// (flat color blocks that read instantly even when blurred/pixelated), these have
// real spatial structure, so the progressive reveal (blur / pixelate / zoom) is
// meaningful — the subject only resolves as the obfuscation lifts.
const ILLUSTRATION_SVGS: Record<IllustrationName, string> = {
  // Apfel — red apple with stem and leaf on a neutral ground.
  apple: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#F4EFE6"/><circle cx="126" cy="122" r="46" fill="#D5341E"/><circle cx="174" cy="122" r="46" fill="#D5341E"/><ellipse cx="150" cy="120" rx="62" ry="54" fill="#E03524"/><ellipse cx="126" cy="100" rx="15" ry="24" fill="#F3795F" opacity="0.55"/><rect x="147" y="58" width="7" height="26" rx="3" fill="#7B4B2A"/><ellipse cx="178" cy="64" rx="24" ry="12" fill="#4CAF50" transform="rotate(-28 178 64)"/></svg>`,
  // Haus — house with roof, door, two windows, sun and ground.
  house: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#BFE3F2"/><rect y="150" width="300" height="50" fill="#8BC34A"/><circle cx="252" cy="44" r="22" fill="#FFD54F"/><rect x="96" y="92" width="108" height="62" fill="#EAD9B0"/><polygon points="86,92 150,48 214,92" fill="#C0392B"/><rect x="138" y="116" width="24" height="38" fill="#7B4B2A"/><rect x="108" y="104" width="22" height="22" fill="#7FC7E8"/><rect x="170" y="104" width="22" height="22" fill="#7FC7E8"/></svg>`,
  // Segelboot — sailboat with two sails on the water under the sun.
  sailboat: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#CDEAF7"/><circle cx="248" cy="46" r="20" fill="#FFD54F"/><rect y="140" width="300" height="60" fill="#2E86C1"/><rect x="148" y="48" width="5" height="92" fill="#5D4037"/><polygon points="150,50 150,132 100,132" fill="#FFFFFF"/><polygon points="156,58 156,132 196,132" fill="#F1F1F1"/><polygon points="92,134 208,134 188,158 112,158" fill="#C0392B"/></svg>`,
};

function imageSvg(spec: ImageSpec): string {
  switch (spec.kind) {
    case 'flag': return FLAG_SVGS[spec.flag];
    case 'gradient': return gradientSvg(GRADIENT_STOPS[spec.gradient]);
    case 'illustration': return ILLUSTRATION_SVGS[spec.illustration];
  }
}

// ── Audio synth (PD classical → WAV → MP3) ──

const SAMPLE_RATE = 44100;

function noteToMidi(name: string): number {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  if (!m) throw new Error(`Invalid note: ${name}`);
  const semis: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + semis[m[1]] + acc; // C4 = 60
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

type Note = [string | null, number]; // [note name or rest, beats]

/** A short ADSR-ish envelope to avoid clicks at note boundaries. */
function envelope(i: number, n: number): number {
  const attack = Math.min(0.02 * SAMPLE_RATE, n * 0.1);
  const release = Math.min(0.08 * SAMPLE_RATE, n * 0.35);
  if (i < attack) return i / attack;
  if (i > n - release) return Math.max(0, (n - i) / release);
  return 1;
}

function synthMelody(notes: Note[], bpm: number, gain = 0.5): Float32Array {
  const beat = 60 / bpm;
  const total = notes.reduce((s, [, b]) => s + b * beat, 0);
  const out = new Float32Array(Math.ceil(total * SAMPLE_RATE) + SAMPLE_RATE / 10);
  let pos = 0;
  for (const [note, beats] of notes) {
    const n = Math.floor(beats * beat * SAMPLE_RATE);
    if (note) {
      const freq = midiToFreq(noteToMidi(note));
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const sample =
          (Math.sin(2 * Math.PI * freq * t) +
            0.4 * Math.sin(2 * Math.PI * 2 * freq * t) +
            0.2 * Math.sin(2 * Math.PI * 3 * freq * t)) /
          1.6;
        out[pos + i] += sample * envelope(i, n) * gain;
      }
    }
    pos += n;
  }
  return out;
}

function mix(buffers: Float32Array[]): Float32Array {
  const len = Math.max(...buffers.map(b => b.length));
  const out = new Float32Array(len);
  for (const b of buffers) for (let i = 0; i < b.length; i++) out[i] += b[i];
  for (let i = 0; i < len; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}

// Recognizable public-domain melodies (transcribed motifs).
const TUNES: Record<TuneName, Note[]> = {
  'fuer-elise': [
    ['E5', 0.5], ['D#5', 0.5], ['E5', 0.5], ['D#5', 0.5], ['E5', 0.5], ['B4', 0.5], ['D5', 0.5], ['C5', 0.5], ['A4', 1],
    [null, 0.5], ['C4', 0.5], ['E4', 0.5], ['A4', 0.5], ['B4', 1],
    [null, 0.5], ['E4', 0.5], ['G#4', 0.5], ['B4', 0.5], ['C5', 1],
  ],
  'ode-to-joy': [
    ['E4', 1], ['E4', 1], ['F4', 1], ['G4', 1], ['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1],
    ['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['E4', 1.5], ['D4', 0.5], ['D4', 2],
  ],
  'eine-kleine': [
    ['G4', 0.75], ['D4', 0.25], ['G4', 0.5], ['D4', 0.5], ['G4', 0.5], ['D4', 0.5], ['G4', 0.5], ['B4', 0.5], ['D5', 1],
    ['C5', 0.75], ['A4', 0.25], ['C5', 0.5], ['A4', 0.5], ['C5', 0.5], ['A4', 0.5], ['C5', 0.5], ['A4', 0.5], ['F#4', 1],
  ],
};

// Sparse root-note accompaniment per tune, for the bandle "bass" layer.
const BASS: Record<TuneName, Note[]> = {
  'fuer-elise': [['A2', 2], ['E2', 2], ['A2', 2], ['E2', 2], ['A2', 2]],
  'ode-to-joy': [['C3', 2], ['C3', 2], ['F3', 2], ['C3', 2], ['G3', 2], ['C3', 2], ['G3', 2], ['C3', 2]],
  'eine-kleine': [['G2', 2], ['D3', 2], ['G2', 2], ['D3', 2], ['G2', 2]],
};

function synthAudio(spec: AudioSpec): Float32Array {
  if (spec.kind === 'melody') return synthMelody(TUNES[spec.tune], 120, 0.5);
  // layered (bandle)
  const melody = () => synthMelody(TUNES[spec.tune], 100, 0.45);
  const bass = () => synthMelody(BASS[spec.tune], 100, 0.4);
  switch (spec.layer) {
    case 'bass': return bass();
    case 'melody': return melody();
    case 'full': return mix([melody(), bass()]);
  }
}

function floatToWav(samples: Float32Array): Buffer {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return buf;
}

function encodeWavToMp3(wav: Buffer, dest: string): Promise<void> {
  const ffmpeg = ffmpegStatic as unknown as string;
  if (!ffmpeg) return Promise.reject(new Error('ffmpeg-static binary not found'));
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-qscale:a', '5', '-y', dest],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr}`))));
    proc.stdin.write(wav);
    proc.stdin.end();
  });
}

// ── Public API ──

/**
 * Generate one media item into `<localAssetsBase>/<item.dest>`. Idempotent —
 * overwrites any existing file. Creates parent dirs as needed.
 */
export async function renderMediaItem(item: MediaItem, localAssetsBase: string): Promise<void> {
  const dest = path.join(localAssetsBase, item.dest);
  await mkdir(path.dirname(dest), { recursive: true });
  if (item.type === 'image') {
    const png = await sharp(Buffer.from(imageSvg(item.spec))).png().toBuffer();
    await writeFile(dest, png);
  } else {
    await encodeWavToMp3(floatToWav(synthAudio(item.spec)), dest);
  }
}
