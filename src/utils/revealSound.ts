// Synthesized score-reveal sounds (Web Audio) — no shipped binary assets, so
// they work offline in every PWA. All best-effort: silently no-op if audio is
// unavailable or blocked (e.g. a projector with no prior user gesture). Callers
// gate on prefers-reduced-motion / inactive-show-tab. See specs/score-reveal.md.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, startOffset: number, duration: number, peak = 0.14): void {
  const c = getCtx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(c.destination);
    const t0 = c.currentTime + startOffset;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  } catch {
    /* ignore */
  }
}

// Major-pentatonic degrees (semitones) climbing well past an octave, so a big
// award rings out as an ascending run instead of repeating one note.
const TALLY_DEGREES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];

/**
 * Point-gain tally: one soft BELL / CELESTA note PER POINT, climbing a
 * pentatonic scale (a +3 award rings three ascending notes). Each note is a
 * pure-sine fundamental plus a quiet octave harmonic with a smooth bell decay —
 * NO arcade pitch-glide — so it reads as an elegant gameshow chime rather than a
 * video-game coin. Audible notes capped so a huge award doesn't run on.
 */
export function playCoinTally(count: number): void {
  const c = getCtx();
  if (!c) return;
  try {
    const n = Math.max(1, Math.min(16, Math.round(count)));
    const base = 523.25; // C5 — warm, not shrill
    const step = 0.085; // gentle, musical spacing (not a rapid arcade tick)
    const now = c.currentTime;
    for (let i = 0; i < n; i++) {
      const t0 = now + i * step;
      const semis = TALLY_DEGREES[Math.min(i, TALLY_DEGREES.length - 1)] ?? 0;
      const freq = base * Math.pow(2, semis / 12);
      // Fundamental + a quiet octave for a glassy celesta shimmer; smooth decay.
      const partials: ReadonlyArray<readonly [number, number, number]> = [
        [1, 0.13, 0.34],
        [2, 0.05, 0.26],
      ];
      for (const [mult, peak, dur] of partials) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.03);
      }
    }
  } catch {
    /* ignore */
  }
}

/** A brighter rising sting played when the lead flips between teams. */
export function playLeadChangeSting(): void {
  // G5 → C6 → E6, slightly louder/triumphant
  tone(783.99, 0, 0.14, 0.16);
  tone(1046.5, 0.1, 0.16, 0.17);
  tone(1318.5, 0.22, 0.3, 0.18);
}
