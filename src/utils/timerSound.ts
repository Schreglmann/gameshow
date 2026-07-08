// Synthesized countdown sounds (Web Audio) — shared by the GM deadline timer
// (DeadlineTimer) and the per-question game timer (Timer), so both share one
// coherent sound theme with no shipped binary asset (works offline in every
// PWA). All best-effort: silently no-op when audio is unavailable or blocked
// (e.g. a projector with no prior user gesture). See
// specs/gamemaster-deadline-timer.md.

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

/**
 * One countdown tick. A soft LOW pulse (660 Hz) for the calm phase; a louder
 * HIGH tick (1320 Hz) for the urgent final seconds. Each component decides WHEN
 * to tick (and at which pitch) — this only renders the blip.
 */
export function playTimerTick(high: boolean): void {
  const c = getCtx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = high ? 1320 : 660;
    const peak = high ? 0.18 : 0.08;
    const now = c.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } catch {
    /* audio unavailable — ignore */
  }
}

/**
 * "Time's up" — a short descending three-note motif (E6 → A5 → A4, last note
 * held) in the same synth timbre as the ticks, so the countdown's end fits the
 * tick sound theme instead of a jarring sampled buzzer.
 */
export function playTimerEnd(): void {
  const c = getCtx();
  if (!c) return;
  try {
    const now = c.currentTime;
    const notes = [
      { f: 1318.5, t: 0.0, d: 0.16 },
      { f: 880.0, t: 0.14, d: 0.16 },
      { f: 440.0, t: 0.28, d: 0.5 },
    ];
    for (const n of notes) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'triangle';
      osc.frequency.value = n.f;
      const t0 = now + n.t;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.d);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + n.d + 0.03);
    }
  } catch {
    /* audio unavailable — ignore */
  }
}
