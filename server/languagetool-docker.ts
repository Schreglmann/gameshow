/**
 * Admin-managed local LanguageTool Docker container.
 *
 * Lets the admin start/stop a local `erikvl87/languagetool` container from the Korrektur tab;
 * while it runs healthily, the spellchecker is routed at it (`setManagedLanguageToolUrl`) so the
 * per-minute public-API rate limit no longer applies and whole-show scans are fast even cold.
 *
 * Local-only: requires Docker on the host running this server. Mirrors the external-process
 * spawning convention used by server/whisper-jobs.ts + server/upscale.ts (fixed argument arrays,
 * no shell → no injection). See specs/languagetool-docker.md.
 */

import { execFile, spawn } from 'child_process';
import { checkLanguageToolHealth, setManagedLanguageToolUrl } from './spellcheck.js';

const IMAGE = 'erikvl87/languagetool';
const CONTAINER = 'gameshow-languagetool';
const PORT = 8010;
const LOCAL_URL = `http://localhost:${PORT}`;

const PROBE_TIMEOUT_MS = 8_000;
const CMD_TIMEOUT_MS = 30_000;
const PULL_TIMEOUT_MS = 600_000; // image pull can take minutes on the first run
const HEALTH_POLL_MS = 1_500;
const HEALTH_TIMEOUT_MS = 120_000; // first cold container start (JVM + dictionaries) can be slow

export type DockerPhase = 'idle' | 'pulling' | 'starting' | 'running' | 'stopping' | 'error';
export type ContainerState = 'running' | 'stopped' | 'absent';

export interface LanguageToolDockerStatus {
  /** Docker CLI is installed AND the daemon is reachable (i.e. we can operate). */
  dockerAvailable: boolean;
  /** Docker CLI is installed (regardless of whether the daemon is running). */
  dockerInstalled: boolean;
  imagePresent: boolean;
  container: ContainerState;
  healthy: boolean;
  /** Current lifecycle phase of the managed container. */
  phase: DockerPhase;
  /** Image-pull progress 0–100 while `phase === 'pulling'`, else null. */
  progress: number | null;
  /** Last progress / error message (German, user-facing). */
  message: string;
  /** The local URL the container is published on. */
  url: string;
  /** True while the checker is actually routed at the local container. */
  active: boolean;
  /** True only when the container is running, healthy AND its language models are warmed —
   *  i.e. fully ready to serve a fast scan. False while pulling/starting/stopping/warming. */
  ready: boolean;
}

interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
  /** 'enoent' = docker not installed; 'timeout' = killed by timeout. */
  spawnError?: 'enoent' | 'timeout' | 'other';
  /** True when the run was aborted via cancel(). */
  cancelled?: boolean;
}

export type DockerRunner = (args: string[], timeoutMs: number) => Promise<DockerResult>;

const realDockerRunner: DockerRunner = (args, timeoutMs) =>
  new Promise<DockerResult>(resolve => {
    execFile('docker', args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = stdout?.toString() ?? '';
      const errOut = stderr?.toString() ?? '';
      if (err) {
        const e = err as NodeJS.ErrnoException & { killed?: boolean };
        if (e.code === 'ENOENT') { resolve({ code: -1, stdout: '', stderr: '', spawnError: 'enoent' }); return; }
        if (e.killed) { resolve({ code: -1, stdout: out, stderr: errOut, spawnError: 'timeout' }); return; }
        const code = typeof e.code === 'number' ? e.code : 1;
        resolve({ code, stdout: out, stderr: errOut });
        return;
      }
      resolve({ code: 0, stdout: out, stderr: errOut });
    });
  });

let dockerRunner: DockerRunner = realDockerRunner;

// `docker pull` streamed line-by-line so we can show a progress bar. Non-TTY pull output emits one
// status line per layer state change (`<id>: Pulling fs layer` … `<id>: Pull complete`), so we
// derive a coarse but real percentage from completed-layers / total-layers.
export type PullRunner = (image: string, onLine: (line: string) => void, timeoutMs: number, signal?: AbortSignal) => Promise<DockerResult>;

const realPullRunner: PullRunner = (image, onLine, timeoutMs, signal) =>
  new Promise<DockerResult>(resolve => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('docker', ['pull', image], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve({ code: -1, stdout: '', stderr: '', spawnError: 'other' });
      return;
    }
    let settled = false;
    const finish = (r: DockerResult) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(r); };
    const onAbort = () => { try { child.kill('SIGKILL'); } catch { /* ignore */ } finish({ code: -1, stdout: '', stderr: '', cancelled: true }); };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } finish({ code: -1, stdout: '', stderr: '', spawnError: 'timeout' }); }, timeoutMs);
    if (signal) { if (signal.aborted) { onAbort(); return; } signal.addEventListener('abort', onAbort); }
    const feed = (buf: Buffer) => { for (const raw of buf.toString().split('\n')) { const l = raw.trim(); if (l) onLine(l); } };
    child.stdout?.on('data', feed);
    child.stderr?.on('data', feed);
    child.on('error', (e: NodeJS.ErrnoException) => finish({ code: -1, stdout: '', stderr: '', spawnError: e.code === 'ENOENT' ? 'enoent' : 'other' }));
    child.on('close', code => finish({ code: code ?? 1, stdout: '', stderr: '' }));
  });

let pullRunner: PullRunner = realPullRunner;

// ── Lifecycle state (in-memory; the Docker daemon is the source of truth for container state) ──
let phase: DockerPhase = 'idle';
let message = '';
let progress: number | null = null; // image-pull percentage while phase === 'pulling'
let cancelRequested = false;
let startAbort: AbortController | null = null;
let warmed = false; // whether the current local container's language models have been (or are being) warmed
let warming = false; // true while the warm-up is actively loading models (server not yet ready to scan)

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const isBusy = () => phase === 'pulling' || phase === 'starting' || phase === 'stopping';

/** Route the checker at the local container; on the FIRST routing this session, also kick off a
 *  background model warm-up so the first scan isn't cold (covers containers we didn't start). */
function routeLocalAndWarm(): void {
  setManagedLanguageToolUrl(LOCAL_URL);
  if (!warmed) { warmed = true; void warmUp(); }
}
function unrouteLocal(): void {
  setManagedLanguageToolUrl(null);
  warmed = false;
}

/** Parse streamed `docker pull` lines into a coarse completed/total-layer percentage. */
function makePullParser(): (line: string) => void {
  const layers = new Set<string>();
  const done = new Set<string>();
  return (line: string) => {
    const m = /^([0-9a-f]{6,}):\s+(.+)$/.exec(line);
    if (!m) return;
    const [, id, status] = m;
    if (id === undefined || status === undefined) return;
    if (/^(Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Already exists|Pull complete)/.test(status)) layers.add(id);
    if (/^(Pull complete|Already exists)/.test(status)) done.add(id);
    progress = layers.size ? Math.round((done.size / layers.size) * 100) : 0;
    message = `Image wird geladen… (${done.size}/${layers.size} Layer)`;
  };
}

function failMessage(action: string, r: DockerResult): string {
  if (r.spawnError === 'timeout') return `Docker-${action} hat das Zeitlimit überschritten.`;
  const detail = (r.stderr || r.stdout).trim().split('\n').pop() || `Exit-Code ${r.code}`;
  return `Docker-${action} fehlgeschlagen: ${detail}`;
}

// ── Probes ──
/** Distinguish "Docker not installed" (ENOENT) from "installed but daemon not running". */
async function probeDocker(): Promise<{ installed: boolean; daemonRunning: boolean }> {
  const r = await dockerRunner(['version', '--format', '{{.Server.Version}}'], PROBE_TIMEOUT_MS);
  if (r.spawnError === 'enoent') return { installed: false, daemonRunning: false };
  // Any non-ENOENT result means the CLI ran; the daemon is up iff it reported a server version.
  return { installed: true, daemonRunning: r.code === 0 && r.stdout.trim().length > 0 };
}

async function dockerAvailable(): Promise<boolean> {
  return (await probeDocker()).daemonRunning;
}

async function imagePresent(): Promise<boolean> {
  const r = await dockerRunner(['images', '-q', IMAGE], PROBE_TIMEOUT_MS);
  return r.code === 0 && r.stdout.trim().length > 0;
}

async function containerState(): Promise<ContainerState> {
  const r = await dockerRunner(['inspect', '-f', '{{.State.Status}}', CONTAINER], PROBE_TIMEOUT_MS);
  if (r.code !== 0) return 'absent'; // inspect fails when the container doesn't exist
  return r.stdout.trim() === 'running' ? 'running' : 'stopped';
}

async function waitHealthy(intervalMs: number, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) return false;
    if ((await checkLanguageToolHealth({ url: LOCAL_URL })).ok) return true;
    if (Date.now() >= deadline || signal?.aborted) return false;
    await sleep(intervalMs);
  }
}

// A fresh container loads its language detector + each language's model on the first /check —
// slow enough that the first scan requests would otherwise time out. Pre-load via the SAME path the
// scan uses (language=auto + preferredVariants) with a German and an English sample, so the detector
// and both models are warm. Best-effort: failures/timeouts here don't fail the start.
async function warmUp(signal?: AbortSignal): Promise<void> {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return; // no network in unit tests
  warming = true; // set synchronously (before the first await) so `ready` is false during warm-up
  try {
    const samples = [
      'Dies ist ein kurzer Aufwärmtext zum Laden des deutschen Sprachmodells.',
      'This is a short warm-up sentence to load the English language model.',
    ];
    for (const text of samples) {
      if (signal?.aborted) return;
      try {
        await fetch(`${LOCAL_URL}/v2/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ text, language: 'auto', preferredVariants: 'de-DE,en-US' }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch { /* best effort — model may still be loading, real checks will finish it */ }
    }
  } finally {
    warming = false;
  }
}

export interface StartOptions {
  /** Health-poll interval (tests shrink this). */
  pollIntervalMs?: number;
  /** Max time to wait for the container to become healthy. */
  healthTimeoutMs?: number;
  /** Set false to skip the language-model warm-up (tests). */
  warmUp?: boolean;
}

/**
 * Start (and if needed pull) the container, then wait until LanguageTool is healthy and route the
 * checker at it. Never rejects — failures set `phase='error'` + a message. Safe to call from a
 * route without awaiting (the endpoint returns the early phase; the UI polls until it settles).
 */
export async function start(opts: StartOptions = {}): Promise<void> {
  if (isBusy() || phase === 'running') return;
  cancelRequested = false;
  const ac = new AbortController();
  startAbort = ac;
  phase = 'starting';
  message = '';
  progress = null;

  // If the user cancelled mid-flight, stop any container we started and return to idle.
  const bailIfCancelled = async (): Promise<boolean> => {
    if (!cancelRequested) return false;
    try { await dockerRunner(['stop', CONTAINER], CMD_TIMEOUT_MS); } catch { /* ignore */ }
    unrouteLocal();
    phase = 'idle';
    message = 'Abgebrochen.';
    progress = null;
    return true;
  };

  try {
    const probe = await probeDocker();
    if (!probe.installed) { phase = 'error'; message = 'Docker ist nicht installiert.'; return; }
    if (!probe.daemonRunning) { phase = 'error'; message = 'Docker-Daemon läuft nicht. Bitte Docker starten und erneut versuchen.'; return; }
    if (await bailIfCancelled()) return;

    if (!(await imagePresent())) {
      phase = 'pulling';
      progress = 0;
      message = 'Image wird geladen…';
      const pull = await pullRunner(IMAGE, makePullParser(), PULL_TIMEOUT_MS, ac.signal);
      progress = null;
      if (pull.cancelled || cancelRequested) { phase = 'idle'; message = 'Abgebrochen.'; return; }
      if (pull.code !== 0) { phase = 'error'; message = failMessage('pull', pull); return; }
    }

    phase = 'starting';
    message = '';
    if (await bailIfCancelled()) return;
    const state = await containerState();
    let r: DockerResult = { code: 0, stdout: '', stderr: '' };
    if (state === 'absent') {
      r = await dockerRunner(
        ['run', '-d', '--name', CONTAINER, '--restart', 'unless-stopped', '-p', `${PORT}:${PORT}`, IMAGE],
        CMD_TIMEOUT_MS,
      );
    } else if (state === 'stopped') {
      r = await dockerRunner(['start', CONTAINER], CMD_TIMEOUT_MS);
    }
    if (r.code !== 0) { phase = 'error'; message = failMessage('start', r); return; }
    if (await bailIfCancelled()) return;

    const ok = await waitHealthy(opts.pollIntervalMs ?? HEALTH_POLL_MS, opts.healthTimeoutMs ?? HEALTH_TIMEOUT_MS, ac.signal);
    if (await bailIfCancelled()) return;
    if (!ok) { phase = 'error'; message = 'LanguageTool wurde nicht rechtzeitig bereit.'; return; }

    // Pre-load the language models so the first scan isn't cold (skipped in tests via opts).
    if (opts.warmUp !== false) { message = 'Sprachmodelle werden geladen…'; await warmUp(ac.signal); }
    if (await bailIfCancelled()) return;

    warmed = true; // already warmed above — don't re-trigger in routeLocalAndWarm
    setManagedLanguageToolUrl(LOCAL_URL);
    phase = 'running';
    message = '';
    console.log(`[language-tool] routing spellchecker at local container ${LOCAL_URL}`);
  } catch (e) {
    phase = 'error';
    message = (e as Error).message || 'Unbekannter Fehler';
  } finally {
    if (startAbort === ac) startAbort = null;
  }
}

/** Cancel an in-progress start (pull or container boot) and return to idle. */
export async function cancel(): Promise<void> {
  if (phase !== 'pulling' && phase !== 'starting') return;
  cancelRequested = true;
  startAbort?.abort();
  // start()'s bail checks handle stopping any container it created; if start() already advanced
  // past its last checkpoint, proactively stop the container so we don't leave it running.
  try { await dockerRunner(['stop', CONTAINER], CMD_TIMEOUT_MS); } catch { /* ignore */ }
  unrouteLocal();
  if (phase === 'pulling' || phase === 'starting') { phase = 'idle'; message = 'Abgebrochen.'; progress = null; }
}

/** Stop the container (kept, not removed) and revert routing to env / public API. */
export async function stop(): Promise<void> {
  unrouteLocal();
  if (!(await dockerAvailable())) { phase = 'idle'; message = ''; return; }
  phase = 'stopping';
  const r = await dockerRunner(['stop', CONTAINER], CMD_TIMEOUT_MS);
  // A non-zero exit usually means "already stopped / no such container" — the goal (not running)
  // is met either way. Only a spawn-level failure is worth surfacing.
  if (r.spawnError) { phase = 'error'; message = failMessage('stop', r); return; }
  phase = 'idle';
  message = '';
}

/** Live status; reconciles routing + the settled phase against the actual container state. */
export async function getStatus(): Promise<LanguageToolDockerStatus> {
  const probe = await probeDocker();
  if (!probe.daemonRunning) {
    if (!isBusy()) phase = phase === 'error' ? 'error' : 'idle';
    unrouteLocal();
    return {
      dockerAvailable: false,
      dockerInstalled: probe.installed,
      imagePresent: false,
      container: 'absent',
      healthy: false,
      phase,
      progress: null,
      message,
      url: LOCAL_URL,
      active: false,
      ready: false,
    };
  }

  const [imagePresentNow, state] = await Promise.all([imagePresent(), containerState()]);
  const healthy = state === 'running' ? (await checkLanguageToolHealth({ url: LOCAL_URL })).ok : false;

  if (state === 'running' && healthy) {
    routeLocalAndWarm();
    if (!isBusy()) { phase = 'running'; message = ''; }
  } else {
    unrouteLocal();
    if (phase === 'running') { phase = 'idle'; message = ''; } // it stopped/died out from under us
  }

  return {
    dockerAvailable: true,
    dockerInstalled: true,
    imagePresent: imagePresentNow,
    container: state,
    healthy,
    phase,
    progress: phase === 'pulling' ? progress : null,
    message: state === 'running' && healthy && warming ? 'Sprachmodelle werden geladen…' : message,
    url: LOCAL_URL,
    active: state === 'running' && healthy,
    ready: state === 'running' && healthy && !warming,
  };
}

/** Fire-and-forget on server startup: re-establish routing if the container is already running. */
export async function detectOnStartup(): Promise<void> {
  try {
    if (!(await dockerAvailable())) return;
    if ((await containerState()) !== 'running') return;
    if ((await checkLanguageToolHealth({ url: LOCAL_URL })).ok) {
      routeLocalAndWarm();
      phase = 'running';
      console.log(`[language-tool] reusing running local container — routing spellchecker at ${LOCAL_URL}`);
    }
  } catch { /* non-fatal */ }
}

// ── Test hooks ──
export function _setDockerRunner(r: DockerRunner | null): void { dockerRunner = r ?? realDockerRunner; }
export function _setPullRunner(r: PullRunner | null): void { pullRunner = r ?? realPullRunner; }
export function _resetDockerState(): void {
  phase = 'idle';
  message = '';
  progress = null;
  cancelRequested = false;
  startAbort = null;
  warmed = false;
  warming = false;
  setManagedLanguageToolUrl(null);
}
