import type { FilmStripeRunMeta } from '@/services/backendApi';

/**
 * A film-stripe batch as the admin form shows it — the run it started itself (from the
 * `prepare` stream) or one it follows over `system-status`. Films run one after another
 * in `paths` order, so the first `done` of them are finished and the next one is being
 * sampled. See specs/games/film-stripe.md.
 */
export interface FilmStripeRun extends FilmStripeRunMeta {
  /** Epoch ms the run started — the base of the elapsed time and the ETA. */
  startedAt: number;
}

/** The film being sampled right now, or null once every film is finished. */
export function runCurrentFilm(run: FilmStripeRun): string | null {
  if (run.done >= run.paths.length) return null;
  return run.current ?? run.paths[run.done] ?? null;
}

/** Progress of the current film, as a fraction 0–1. */
function currentFraction(run: FilmStripeRun): number {
  return runCurrentFilm(run) === null ? 0 : Math.min(100, Math.max(0, run.currentPercent ?? 0)) / 100;
}

/** Batch progress 0–100, with the current film's progress blended in so the bar keeps
 *  moving during a film that takes minutes. */
export function runBatchPercent(run: FilmStripeRun): number {
  if (run.paths.length === 0) return 100;
  return Math.min(100, Math.floor(((run.done + currentFraction(run)) / run.paths.length) * 100));
}

/** Seconds until the batch is done, or null while there is too little to go on.
 *  Extrapolates the time spent per film; a film that failed took (almost) no work and
 *  counts as none, so a missing NAS file early on does not make the rest look quick. */
export function runEtaSeconds(run: FilmStripeRun, now: number): number | null {
  const elapsed = (now - run.startedAt) / 1000;
  const fraction = currentFraction(run);
  const workDone = run.done - run.failed.length + fraction;
  const workLeft = run.paths.length - run.done - fraction;
  if (elapsed <= 0 || workDone <= 0 || workLeft <= 0) return null;
  if (runBatchPercent(run) < 2) return null;
  return (elapsed / workDone) * workLeft;
}

export type FilmRunState =
  | { kind: 'current'; percent: number }
  | { kind: 'queued' }
  | { kind: 'failed'; error: string }
  | { kind: 'done' };

/** What the run is doing with one film; null when the film is not part of the run. */
export function runFilmState(run: FilmStripeRun, path: string): FilmRunState | null {
  const index = run.paths.indexOf(path);
  if (index < 0) return null;
  const failed = run.failed.find(f => f.path === path);
  if (failed) return { kind: 'failed', error: failed.error };
  if (index < run.done) return { kind: 'done' };
  if (path === runCurrentFilm(run)) return { kind: 'current', percent: run.currentPercent ?? 0 };
  return { kind: 'queued' };
}
