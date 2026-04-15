/**
 * Whisper transcription jobs.
 *
 * Per-video, persistent, controllable from the admin UI. One job per (video, language).
 *
 * Design highlights — see specs/whisper-transcription.md for the full spec.
 *
 *  • Detached spawn. Child whisper processes are spawned with `detached: true` + `.unref()`
 *    and write to a log file (not stdio inherited from Node). Killing the Node parent does
 *    NOT take the whisper child with it — transcripts that were ~30% in keep running, and
 *    on the next Node start we reattach via PID liveness check + log tail.
 *
 *  • Persistent state. `jobs.json` lives under `local-assets/videos/.whisper-cache/` so it
 *    survives reboots AND `sync:push` mirrors it to the NAS. Debounced atomic write — same
 *    pattern as `hdr.json`.
 *
 *  • Signals. Pause/resume use POSIX SIGSTOP/SIGCONT (works identically on macOS + Linux);
 *    Stop uses SIGTERM with a SIGKILL fallback.
 *
 *  • Throttle. Wrapped in `taskpolicy -c background` on macOS or `nice -n 19 ionice -c 3`
 *    on Linux so the operator's foreground apps always preempt during the ~25-min runtime.
 *
 *  • Binary resolver. Looks for whisper-cli in this order:
 *      1. WHISPER_CPP_BIN env var
 *      2. local-assets/.whisper-build/whisper-cli (built by `npm run whisper:install`)
 *      3. system PATH (whisper-cli, whisper-cpp, main)
 *    so any of: pre-built local, Homebrew install, apt install, custom build all just work.
 *
 *  • Concurrency. At most WHISPER_CONCURRENCY (default 1) running at a time. Excess starts
 *    queue as `pending`. Whisper is heavy enough that running two in parallel hurts more
 *    than it helps on a single workstation.
 */

import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, statSync, unlinkSync, renameSync, appendFileSync, watch as fsWatch, type FSWatcher } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const execFileAsync = promisify(execFile);

const FFMPEG_BIN: string = (ffmpegStatic as unknown as string) ?? 'ffmpeg';
const FFPROBE_BIN: string = ffprobeStatic.path ?? 'ffprobe';

// ── Types ──────────────────────────────────────────────────────────────────────

export type WhisperLanguage = 'en' | 'de';
export type WhisperStatus = 'pending' | 'running' | 'paused' | 'done' | 'error' | 'interrupted';
/** Two-phase progress: ffmpeg extracts the WAV first (~1 min for a 2.5h movie), then whisper
 *  transcribes it (~15-25 min). Both phases report 0-100 in `percent` so the UI can render a
 *  single bar; `phase` tells the UI which step is being shown. */
export type WhisperPhase = 'extracting' | 'transcribing';

export interface WhisperJob {
  /** Relative path under local-assets/videos, e.g. "Harry Potter und der Stein der Weisen.m4v" */
  videoRelPath: string;
  language: WhisperLanguage;
  status: WhisperStatus;
  /** Current phase when status === 'running'/'paused'. Undefined otherwise. */
  phase?: WhisperPhase;
  /** Latest percent 0-100 (integer) for the current phase. For the transcribing phase this
   *  is the *displayed* percent (resume-aware), not whisper's raw 0-100 of remaining audio. */
  percent: number;
  /** Epoch ms when the current phase started — used by the frontend ETA computation so
   *  ETA resets at the phase boundary instead of skewing across both phases. */
  phaseStartedAt: number;
  /** Detached child PID. null when not running (pending/done/error/interrupted) or paused-with-dead-pid. */
  pid: number | null;
  startedAt: number;
  updatedAt: number;
  /** Set when `status === 'done'`. Absolute path to the .json transcript on disk. */
  transcriptPath: string | null;
  /** Stdout/stderr tee log, used to read progress and (after Node restart) reattach. */
  logPath: string;
  /** ffmpeg `0:a:N` index of the audio stream we extracted (for diagnostics). */
  audioStreamIndex: number;
  /** Total audio duration (seconds) — set during phase 1 or reconciled at resume time.
   *  Required for resume-aware progress scaling: the watcher needs to translate whisper's
   *  "0-100 of remaining audio" into a "0-100 of total audio" displayed percent. */
  audioDurationSec?: number;
  /** Resume offset (milliseconds) used for the currently running whisper child. 0 when this
   *  is the first run for this WAV. Persisted so a Node-restart reattach knows the scaling. */
  resumeOffsetMs?: number;
  /** Last error message, if status === 'error'. */
  error?: string;
  /** Human-friendly bgTask id from the host server's task registry, when running. */
  bgTaskId?: string;
}

/** Marker line we write to the log right before spawning whisper with --offset, so a
 *  later parser can attribute subsequent segment timestamps to the correct absolute time
 *  origin. Self-describing: even if WhisperJob.resumeOffsetMs is lost, the log alone is
 *  enough to reconstruct the merged transcript. */
const RESUME_MARKER_PREFIX = '=== WHISPER RESUME OFFSET ';
const RESUME_MARKER_SUFFIX = ' MS ===';

export interface WhisperJobsDeps {
  /** Absolute path to local-assets/ */
  localAssetsBase: string;
  /** Resolve a relative video path to an absolute path on disk (or null). */
  resolveVideoPath: (relPath: string) => string | null;
  /** Convert a relative path to a flat filesystem-safe slug (matches server/index.ts). */
  cacheSlug: (relPath: string) => string;
  /** Hooks into the host server's task registry so jobs surface in SystemTab. */
  bgTaskStart: (type: string, label: string, detail?: string) => string;
  bgTaskUpdate: (id: string, detail: string) => void;
  bgTaskDone: (id: string) => void;
  bgTaskError: (id: string, detail?: string) => void;
}

export interface WhisperJobsApi {
  reconcile: () => Promise<void>;
  getAll: () => WhisperJob[];
  get: (relPath: string) => WhisperJob | null;
  start: (relPath: string, language: WhisperLanguage) => Promise<WhisperJob>;
  pause: (relPath: string) => Promise<WhisperJob>;
  resume: (relPath: string) => Promise<WhisperJob>;
  stop: (relPath: string) => Promise<WhisperJob>;
  /** Read raw transcript JSON when status === 'done'. Returns null otherwise. */
  readTranscript: (relPath: string) => Promise<unknown | null>;
  /** Health probe for /whisper/health: is the binary + model resolvable? */
  health: () => Promise<{ ok: boolean; binPath: string | null; modelPath: string | null; reason?: string }>;
  /** Flush pending state writes synchronously. Call from SIGTERM handler. */
  flushSync: () => void;
}

// ── Module setup ───────────────────────────────────────────────────────────────

export function setupWhisperJobs(deps: WhisperJobsDeps): WhisperJobsApi {
  const CACHE_BASE = path.join(deps.localAssetsBase, 'videos', '.whisper-cache');
  const MODEL_BASE = path.join(CACHE_BASE, 'models');
  const JOBS_FILE = path.join(CACHE_BASE, 'jobs.json');
  const BUILD_DIR = path.join(deps.localAssetsBase, '.whisper-build');

  // In-memory job state (source of truth at runtime, persisted to JOBS_FILE on change)
  const jobs = new Map<string, WhisperJob>();
  // Active fs watchers for log files (to read --print-progress in real time)
  const watchers = new Map<string, FSWatcher>();
  // Polling timers as fallback for fs.watch (some FSes don't fire change events reliably)
  const pollers = new Map<string, ReturnType<typeof setInterval>>();
  // FIFO of pending jobs awaiting a free concurrency slot
  const pendingQueue: string[] = [];
  let runningCount = 0;
  const WHISPER_CONCURRENCY = Number(process.env.WHISPER_CONCURRENCY) || 1;

  // ── Persistence (JSON file, debounced) ──

  function loadFromDisk(): void {
    try {
      if (!existsSync(JOBS_FILE)) return;
      const data = JSON.parse(readFileSync(JOBS_FILE, 'utf8')) as Record<string, Partial<WhisperJob>>;
      for (const [k, v] of Object.entries(data)) {
        // Backfill required fields that may be missing from older job records, so
        // recently-extended state stays type-safe at runtime.
        const job: WhisperJob = {
          videoRelPath: v.videoRelPath ?? k,
          language: v.language ?? 'en',
          status: v.status ?? 'interrupted',
          phase: v.phase,
          percent: v.percent ?? 0,
          phaseStartedAt: v.phaseStartedAt ?? v.startedAt ?? Date.now(),
          pid: v.pid ?? null,
          startedAt: v.startedAt ?? Date.now(),
          updatedAt: v.updatedAt ?? Date.now(),
          transcriptPath: v.transcriptPath ?? null,
          logPath: v.logPath ?? '',
          audioStreamIndex: v.audioStreamIndex ?? -1,
          audioDurationSec: v.audioDurationSec,
          resumeOffsetMs: v.resumeOffsetMs,
          error: v.error,
        };
        jobs.set(k, job);
      }
    } catch (err) {
      console.warn(`[whisper-jobs] Failed to load ${JOBS_FILE}: ${(err as Error).message}`);
    }
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSave(): void {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushSync();
    }, 500);
  }

  function flushSync(): void {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
      // Serialise without bgTaskId or any ephemeral fields the consumer doesn't need.
      const out: Record<string, WhisperJob> = {};
      for (const [k, j] of jobs) {
        out[k] = { ...j, bgTaskId: undefined };
      }
      writeFileSync(JOBS_FILE, JSON.stringify(out, null, 2) + '\n');
    } catch (err) {
      console.warn(`[whisper-jobs] Failed to save ${JOBS_FILE}: ${(err as Error).message}`);
    }
  }

  // ── Binary + model resolution (cached for the process lifetime) ──

  let cachedBinPath: string | null | undefined;
  function resolveBinary(): string | null {
    if (cachedBinPath !== undefined) return cachedBinPath;

    // 1) Explicit env var override
    const envBin = process.env.WHISPER_CPP_BIN;
    if (envBin && existsSync(envBin)) { cachedBinPath = envBin; return cachedBinPath; }

    // 2) Project-local build dir
    const candidates = [
      path.join(BUILD_DIR, 'whisper-cli'),
      path.join(BUILD_DIR, 'main'),
      path.join(BUILD_DIR, 'bin', 'whisper-cli'),
      path.join(BUILD_DIR, 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
      path.join(BUILD_DIR, 'whisper.cpp', 'main'),
    ];
    for (const c of candidates) {
      if (existsSync(c)) { cachedBinPath = c; return cachedBinPath; }
    }

    // 3) System PATH — try common names whisper.cpp ships with
    for (const name of ['whisper-cli', 'whisper-cpp', 'whisper']) {
      const p = whichSync(name);
      if (p) { cachedBinPath = p; return cachedBinPath; }
    }

    cachedBinPath = null;
    return null;
  }

  function resolveModel(): string | null {
    const envModel = process.env.WHISPER_MODEL;
    if (envModel && existsSync(envModel)) return envModel;
    // Default: largest practical model that still runs reasonably on CPU/Metal
    const preferred = [
      'ggml-large-v3-turbo.bin',
      'ggml-large-v3.bin',
      'ggml-medium.bin',
      'ggml-small.bin',
      'ggml-base.bin',
    ];
    for (const m of preferred) {
      const p = path.join(MODEL_BASE, m);
      if (existsSync(p)) return p;
    }
    return null;
  }

  // ── Spawn helpers ──

  function throttlePrefix(): string[] {
    if (process.platform === 'darwin') return ['taskpolicy', '-c', 'background'];
    if (process.platform === 'linux') return ['nice', '-n', '19', 'ionice', '-c', '3'];
    return []; // windows: no throttle wrapper, just spawn directly
  }

  /** Find first audio stream tagged with the requested language (audio-relative 0:a:N
   *  index — falls back to 0). Also returns the file's overall duration in seconds so the
   *  extraction step can compute progress. */
  async function pickAudioStreamIndex(absVideoPath: string, language: WhisperLanguage): Promise<{ index: number; durationSec: number }> {
    const target = language === 'en' ? 'eng' : 'deu';
    let durationSec = 0;
    let index = 0;
    try {
      const { stdout } = await execFileAsync(FFPROBE_BIN, [
        '-v', 'error',
        '-select_streams', 'a',
        '-show_entries', 'stream=index:stream_tags=language:format=duration',
        '-of', 'json',
        absVideoPath,
      ]);
      const data = JSON.parse(stdout) as {
        streams?: Array<{ index: number; tags?: { language?: string } }>;
        format?: { duration?: string };
      };
      const streams = data.streams ?? [];
      for (let i = 0; i < streams.length; i++) {
        if ((streams[i].tags?.language || '').toLowerCase() === target) { index = i; break; }
      }
      durationSec = data.format?.duration ? parseFloat(data.format.duration) : 0;
    } catch { /* fall through with defaults */ }
    return { index, durationSec };
  }

  function paths(relPath: string, language: WhisperLanguage): { wavPath: string; jsonPath: string; logPath: string; jsonOutBase: string } {
    const slug = `${deps.cacheSlug(relPath).replace(/\.[^.]+$/, '')}__${language}`;
    return {
      wavPath: path.join(CACHE_BASE, `${slug}.wav`),
      jsonPath: path.join(CACHE_BASE, `${slug}.json`),
      logPath: path.join(CACHE_BASE, `${slug}.log`),
      // whisper-cli adds `.json` to whatever -of value we pass
      jsonOutBase: path.join(CACHE_BASE, slug),
    };
  }

  /** Mild POSIX nice for ffmpeg — same precedent as `spawnBackgroundFfmpeg` in
   *  server/index.ts. Specifically NOT `taskpolicy -c background` like the whisper step
   *  uses: macOS background QoS throttles BOTH cpu and IO, which makes a 10+ GB sequential
   *  read crawl. Whisper is the long-running CPU-bound step that warrants the heavy
   *  throttle; ffmpeg extraction is short-lived (~1 min) and IO-heavy. */
  function ffmpegThrottlePrefix(): string[] {
    if (process.platform === 'win32') return [];
    return ['nice', '-n', '10'];
  }

  /** Spawn ffmpeg to extract one audio stream as 16 kHz mono WAV — Whisper's native input.
   *  Streams progress via ffmpeg's `-progress -` machine-readable output (lines like
   *  `out_time_ms=N`). When `durationSec` is known we map that to a 0-100 percent and
   *  invoke onProgress so the caller can update job state + bgTask. */
  function extractAudio(
    absVideoPath: string,
    audioIdx: number,
    wavOut: string,
    language: WhisperLanguage,
    durationSec: number,
    onProgress: (percent: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      mkdirSync(path.dirname(wavOut), { recursive: true });
      const tmp = wavOut + '.tmp';
      const args = [
        ...ffmpegThrottlePrefix(),
        FFMPEG_BIN,
        '-y',
        '-vn',                             // never decode video — short-circuits any side decode
        '-threads', '2',                   // matches spawnBackgroundFfmpeg cap
        '-i', absVideoPath,
        '-map', `0:a:${audioIdx}`,
        '-ac', '1', '-ar', '16000',
        '-f', 'wav',
        '-progress', 'pipe:1',             // machine-readable progress to stdout
        '-nostats',                        // suppress the chatty "size= time=" stderr line
        tmp,
      ];
      const proc = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'ignore'] });
      let lastReportedPct = -1;
      let stdoutBuf = '';
      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf8');
        // ffmpeg emits a block of key=value lines roughly every second when using -progress.
        // Process complete lines; keep partial trailing data in the buffer.
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
          const m = /^out_time_ms=(\d+)/.exec(line);
          if (m && durationSec > 0) {
            const outMs = parseInt(m[1], 10);
            const pct = Math.min(99, Math.floor((outMs / 1000) / durationSec * 100));
            if (pct !== lastReportedPct && pct >= 0) {
              lastReportedPct = pct;
              onProgress(pct);
            }
          }
        }
      });
      proc.on('error', reject);
      proc.on('close', code => {
        if (code !== 0) {
          try { unlinkSync(tmp); } catch { /* noop */ }
          reject(new Error(`ffmpeg exit ${code} extracting audio (track ${audioIdx}, ${language})`));
          return;
        }
        try {
          renameSync(tmp, wavOut);  // atomic rename so partial WAVs are never picked up
          onProgress(100);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /** Spawn whisper-cli detached so it survives Node restart. Returns the PID. When
   *  `resumeOffsetMs > 0`, whisper skips the first N ms of audio (`--offset`) so an
   *  interrupted job can pick up roughly where it left off instead of re-transcribing
   *  the whole file. The log marker written by the caller before this spawn lets the
   *  final-merge step attribute the new (relative-time) segments correctly. */
  function spawnWhisper(
    binPath: string,
    modelPath: string,
    wavPath: string,
    jsonOutBase: string,
    logPath: string,
    language: WhisperLanguage,
    resumeOffsetMs: number = 0,
  ): number {
    mkdirSync(path.dirname(logPath), { recursive: true });
    const fd = openSync(logPath, 'a');
    const args = [
      ...throttlePrefix(),
      binPath,
      '-m', modelPath,
      '-l', language,
      '-oj',                  // output JSON (word-level when combined with -ml)
      '-ml', '1',             // max segment length 1 → effectively word-level segments
      '-of', jsonOutBase,     // whisper appends .json
      '--print-progress',     // emits "whisper_print_progress_callback: progress = N" lines
      // Anti-hallucination settings — without these, whisper.cpp gets stuck in infinite
      // loops on audio with extended silence/ambient music (very common in movies).
      // Observed failure mode: a 2.5h film produces 48 k tokens with only ~1 k unique,
      // because a single transcribed phrase gets fed back into the decoder and repeats
      // for the rest of the file. Verified by hand on a 4-minute HP1 slice:
      //
      //   broken:    no flags             → 2-6 % diversity, zero character names
      //   fixed:     these flags applied  → 42 % diversity, real dialogue
      //
      // Flag naming trap: older whisper.cpp supported `-nc` (no-context); recent
      // Homebrew builds removed it and use `-mc 0` (max-context=0) instead. Our
      // Homebrew-installed whisper-cli silently REJECTED `-nc` ("unknown argument") and
      // fell back to its default (context ON = the feedback channel stays open). Hence
      // the continued loops. `-mc 0` is the portable spelling and works on both.
      '-mc', '0',                                   // --max-context 0: no previous-text conditioning
      '-sns',                                       // --suppress-nst: suppress non-speech tokens
      '--no-speech-thold', '0.6',                   // silence filter — skip segments that sound non-speech
      '--entropy-thold', '2.4',                     // decoder-fail entropy threshold
      '--logprob-thold', '-0.8',                    // decoder-fail logprob threshold (stricter than default -1.0)
      '--temperature', '0.0',                       // deterministic decoding; fallback kicks in on threshold trips
      '--temperature-inc', '0.2',                   // fallback temperature step
      '-bs', '5',                                   // beam size 5 (default, explicit)
      // Log the final argv to stderr so operators can verify post-hoc which flags the
      // binary was actually called with. The log file persists across the transcription
      // (only deleted on clean success), so a broken transcript leaves a trail.
      ...(resumeOffsetMs > 0 ? ['--offset', String(resumeOffsetMs)] : []),
      wavPath,
    ];
    // Echo the argv to both the Node console AND to the log file (append, not truncate —
    // a resume run may have just written a RESUME marker that we must not clobber) so the
    // operator can verify which flags the binary was actually called with.
    const argLine = `[whisper-jobs] spawning: ${args.join(' ')}\n`;
    console.log(argLine.trimEnd());
    try { appendFileSync(logPath, argLine); } catch { /* not fatal */ }
    const proc = spawn(args[0], args.slice(1), {
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    proc.unref();
    if (proc.pid === undefined) {
      throw new Error('Failed to spawn whisper child (no pid)');
    }
    return proc.pid;
  }

  // ── Progress watching ──

  /**
   * Tail the log file looking for `progress = N` and process exit. Updates job state
   * + bgTask via deps.
   *
   * Two parts:
   *   - fs.watch fires when the log file changes (whisper writes progress lines)
   *   - a 5s setInterval polls liveness via `kill(pid, 0)` to detect process death
   *     (since fs.watch never fires for a process exit)
   */
  function startWatcher(job: WhisperJob): void {
    if (watchers.has(job.videoRelPath)) return; // already watching
    if (!existsSync(job.logPath)) return;       // can't watch a log that isn't there yet

    const reReadProgress = (): void => {
      // The watcher only ever writes `transcribing` percentages; if for some reason it
      // fires while still in extraction (e.g. log file shared) we ignore it so the
      // ffmpeg-driven percent isn't clobbered.
      if (job.phase && job.phase !== 'transcribing') return;
      try {
        const text = readFileSync(job.logPath, 'utf8');
        // Only the LAST "progress = N" line is relevant. Whisper resets to 0 each run, so
        // for resumed jobs we need to scale: displayed = priorPct + (whisper_pct of the
        // remaining-after-offset window).
        const allMatches = text.match(/progress\s*=\s*(\d+)/g);
        if (!allMatches || allMatches.length === 0) return;
        const last = allMatches[allMatches.length - 1];
        const m = /(\d+)/.exec(last);
        if (!m) return;
        const whisperPct = Math.min(100, Math.max(0, parseInt(m[1], 10)));

        let displayed = whisperPct;
        const totalSec = job.audioDurationSec ?? 0;
        const offsetMs = job.resumeOffsetMs ?? 0;
        if (totalSec > 0 && offsetMs > 0) {
          const priorFrac = Math.min(1, offsetMs / 1000 / totalSec);
          // Whisper reports 0..100 of the audio AFTER the offset
          displayed = Math.round((priorFrac + (whisperPct / 100) * (1 - priorFrac)) * 100);
          displayed = Math.min(100, Math.max(0, displayed));
        }
        if (displayed !== job.percent) {
          job.percent = displayed;
          job.updatedAt = Date.now();
          if (job.bgTaskId) deps.bgTaskUpdate(job.bgTaskId, `${displayed} %`);
          scheduleSave();
        }
      } catch { /* file may have rotated or been deleted */ }
    };

    try {
      const w = fsWatch(job.logPath, { persistent: false }, () => reReadProgress());
      watchers.set(job.videoRelPath, w);
    } catch (err) {
      console.warn(`[whisper-jobs] fs.watch failed for ${job.logPath}: ${(err as Error).message}; falling back to polling`);
    }

    // Poll progress + liveness — fs.watch alone misses some platforms; polling is the safety net.
    const poller = setInterval(() => {
      reReadProgress();
      if (job.pid && !isProcessAlive(job.pid)) {
        finishJob(job);
      }
    }, 5000);
    pollers.set(job.videoRelPath, poller);
  }

  function stopWatcher(relPath: string): void {
    const w = watchers.get(relPath);
    if (w) { try { w.close(); } catch { /* ignore */ } watchers.delete(relPath); }
    const p = pollers.get(relPath);
    if (p) { clearInterval(p); pollers.delete(relPath); }
  }

  /** Called when the watcher detects the process exited. Inspect the JSON transcript to
   *  decide done vs error. */
  function finishJob(job: WhisperJob): void {
    job.pid = null;
    job.updatedAt = Date.now();
    job.phase = undefined;
    const { jsonPath: expected, wavPath, logPath } = paths(job.videoRelPath, job.language);

    // Build the merged transcript from the log. The log accumulates segments across all
    // resume cycles (with RESUME markers separating offset frames); whisper's own JSON
    // output only contains the LAST run's segments at relative timestamps. We always
    // overwrite whisper's JSON with our own merged version so absolute timestamps are
    // correct downstream (generate-hp-spells.ts depends on this).
    let mergedSegmentCount = 0;
    if (existsSync(logPath)) {
      try {
        const logText = readFileSync(logPath, 'utf8');
        const segments = parseLogSegments(logText);
        if (segments.length > 0) {
          mergedSegmentCount = segments.length;
          const merged = buildTranscriptJson(segments);
          // Atomic write so a crash mid-write doesn't leave a half-file
          const tmp = expected + '.tmp';
          writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n');
          renameSync(tmp, expected);
        }
      } catch (err) {
        console.warn(`[whisper-jobs] Failed to build merged JSON for ${job.videoRelPath}: ${(err as Error).message}`);
      }
    }

    // Diversity-based hallucination check. Whisper.cpp sometimes gets stuck in an infinite
    // loop where a single phrase repeats for the rest of the file — observed empirically
    // on every HP movie we transcribed. Symptom: tens of thousands of tokens but only a
    // few hundred unique. A healthy movie transcription is 15-25 % diversity. We reject
    // under 10 %. Failing loudly is much better than silently producing garbage that the
    // downstream spell-matcher then returns zero results from.
    let looped = false;
    if (mergedSegmentCount > 2000) {
      const tokens = (readFileSync(expected, 'utf8').match(/"text"\s*:\s*"([^"]*)"/g) || []);
      const words: string[] = [];
      for (const m of tokens) {
        const text = /"text"\s*:\s*"([^"]*)"/.exec(m)?.[1] ?? '';
        for (const w of text.split(/\s+/)) if (w) words.push(w.toLowerCase());
      }
      if (words.length > 2000) {
        const diversity = new Set(words).size / words.length;
        if (diversity < 0.10) {
          looped = true;
          console.warn(`[whisper-jobs] Hallucination detected for ${job.videoRelPath}: ${words.length} words but only ${new Set(words).size} unique (${(diversity * 100).toFixed(1)} %). Marking as error.`);
        }
      }
    }

    if (looped) {
      // Delete the bad JSON so a rerun starts clean; KEEP the wav+log so the operator can
      // inspect them if they want (log tail still shows the original whisper args + output).
      try { unlinkSync(expected); } catch { /* ignore */ }
      job.status = 'error';
      job.error = 'Whisper ist in eine Endlosschleife gefallen (hallucination loop). Bitte erneut transkribieren — der nächste Lauf ist typischerweise sauber.';
      if (job.bgTaskId) deps.bgTaskError(job.bgTaskId, 'Hallucination-Loop — erneut versuchen');
    } else if (existsSync(expected) && mergedSegmentCount > 0) {
      job.status = 'done';
      job.percent = 100;
      job.transcriptPath = expected;
      job.resumeOffsetMs = 0;
      // Clean up the WAV + log — we don't need them any more
      try { unlinkSync(wavPath); } catch { /* probably already gone */ }
      try { unlinkSync(logPath); } catch { /* probably already gone */ }
      if (job.bgTaskId) deps.bgTaskDone(job.bgTaskId);
    } else {
      job.status = 'error';
      job.error = 'Transkript wurde nicht erzeugt (whisper-Prozess endete ohne Output)';
      if (job.bgTaskId) deps.bgTaskError(job.bgTaskId, job.error);
    }
    job.bgTaskId = undefined;
    runningCount = Math.max(0, runningCount - 1);
    stopWatcher(job.videoRelPath);
    scheduleSave();
    // Drain queue
    drainQueue();
  }

  function drainQueue(): void {
    while (runningCount < WHISPER_CONCURRENCY && pendingQueue.length > 0) {
      const next = pendingQueue.shift()!;
      const job = jobs.get(next);
      if (!job || job.status !== 'pending') continue;
      // Async — don't block the drain loop; errors surface via job.status
      void launch(job).catch(err => console.warn(`[whisper-jobs] launch error: ${(err as Error).message}`));
    }
  }

  // ── Lifecycle ──

  /** Actually spawn whisper for an already-prepared `pending` job. */
  async function launch(job: WhisperJob): Promise<void> {
    const binPath = resolveBinary();
    const modelPath = resolveModel();
    if (!binPath || !modelPath) {
      job.status = 'error';
      job.error = !binPath
        ? 'whisper-cli wurde nicht gefunden — bitte `npm run whisper:install` ausführen'
        : 'Whisper-Modell wurde nicht gefunden — bitte `npm run whisper:download-model` ausführen';
      job.updatedAt = Date.now();
      scheduleSave();
      return;
    }
    const absVideo = deps.resolveVideoPath(job.videoRelPath);
    if (!absVideo) {
      job.status = 'error';
      job.error = `Videodatei nicht gefunden: ${job.videoRelPath}`;
      job.updatedAt = Date.now();
      scheduleSave();
      return;
    }

    runningCount++;
    job.bgTaskId = deps.bgTaskStart('whisper-asr', `Whisper: ${path.basename(job.videoRelPath)} (${job.language.toUpperCase()})`, 'Audio extrahieren · 0 %');
    job.status = 'running';
    job.phase = 'extracting';
    job.percent = 0;
    job.startedAt = Date.now();
    job.phaseStartedAt = job.startedAt;
    job.updatedAt = job.startedAt;
    scheduleSave();

    const { wavPath, logPath, jsonOutBase } = paths(job.videoRelPath, job.language);
    job.logPath = logPath;
    // Do NOT truncate the log on launch — we use it as the resume source. start() already
    // unlinked the previous JSON output (whisper writes its own at completion); the log,
    // if present, contains the partial transcript from a previous interrupted run.

    try {
      // Phase 1: extract WAV (~1 min). Skip if a complete WAV from a previous run is
      // already on disk for the same (video, language) pair — extractAudio uses an
      // atomic .tmp+rename, so the presence of the final file means it's complete and
      // bit-identical to what we'd produce. Saves the 1-min step on every restart of an
      // interrupted job. The WAV is deleted by `finishJob` once whisper succeeds.
      let durationSec = job.audioDurationSec ?? 0;
      if (existsSync(wavPath)) {
        // Still need the audio stream index for diagnostics + the duration for resume
        // progress scaling — both come from one ffprobe call, cheap.
        const audioInfo = await pickAudioStreamIndex(absVideo, job.language);
        job.audioStreamIndex = audioInfo.index;
        if (audioInfo.durationSec > 0) durationSec = audioInfo.durationSec;
        job.percent = 100;
        job.updatedAt = Date.now();
        if (job.bgTaskId) deps.bgTaskUpdate(job.bgTaskId, 'Audio (Cache) · 100 %');
        scheduleSave();
        console.log(`[whisper-jobs] Reusing cached WAV for ${job.videoRelPath} (${job.language}) — skipping extraction`);
      } else {
        const audioInfo = await pickAudioStreamIndex(absVideo, job.language);
        job.audioStreamIndex = audioInfo.index;
        durationSec = audioInfo.durationSec;
        await extractAudio(absVideo, audioInfo.index, wavPath, job.language, durationSec, (pct) => {
          if (job.phase !== 'extracting') return;  // race guard if a stop arrived
          job.percent = pct;
          job.updatedAt = Date.now();
          if (job.bgTaskId) deps.bgTaskUpdate(job.bgTaskId, `Audio extrahieren · ${pct} %`);
          scheduleSave();
        });
      }
      job.audioDurationSec = durationSec;

      // Phase 2: resume-aware whisper spawn. If the log file from a previous interrupted
      // run contains complete segments, advance whisper past that point with --offset and
      // append a marker so the parser can tell where the new segments start.
      let resumeOffsetMs = 0;
      let priorPercent = 0;
      if (existsSync(logPath)) {
        try {
          const existingLog = readFileSync(logPath, 'utf8');
          const segs = parseLogSegments(existingLog);
          if (segs.length > 0) {
            // Round down to the nearest 100 ms so a tiny timing jitter at the boundary
            // doesn't cause us to skip the audio just before a segment we missed.
            resumeOffsetMs = Math.max(0, Math.floor(segs[segs.length - 1].toMs / 100) * 100);
          }
        } catch { /* fall through with offset 0 */ }
      }
      // Append the marker so the post-completion JSON-builder knows where the offset frame
      // starts. Only write if we're actually resuming — first-time runs don't need it.
      if (resumeOffsetMs > 0) {
        try { appendFileSync(logPath, `\n${RESUME_MARKER_PREFIX}${resumeOffsetMs}${RESUME_MARKER_SUFFIX}\n`); }
        catch { /* if append fails the run still works, only the merge step is degraded */ }
      } else {
        // Fresh run — start with a clean log so old progress lines don't confuse the watcher
        try { writeFileSync(logPath, ''); } catch { /* ignore */ }
      }
      if (durationSec > 0 && resumeOffsetMs > 0) {
        priorPercent = Math.min(99, Math.floor((resumeOffsetMs / 1000 / durationSec) * 100));
      }
      job.resumeOffsetMs = resumeOffsetMs;

      job.phase = 'transcribing';
      job.percent = priorPercent;
      job.phaseStartedAt = Date.now();
      job.updatedAt = job.phaseStartedAt;
      if (job.bgTaskId) deps.bgTaskUpdate(job.bgTaskId, resumeOffsetMs > 0 ? `Fortgesetzt ab ${priorPercent} %` : '0 %');
      const pid = spawnWhisper(binPath, modelPath, wavPath, jsonOutBase, logPath, job.language, resumeOffsetMs);
      job.pid = pid;
      job.updatedAt = Date.now();
      scheduleSave();
      startWatcher(job);
    } catch (err) {
      job.status = 'error';
      job.error = (err as Error).message;
      job.updatedAt = Date.now();
      job.pid = null;
      job.phase = undefined;
      runningCount = Math.max(0, runningCount - 1);
      if (job.bgTaskId) deps.bgTaskError(job.bgTaskId, job.error);
      job.bgTaskId = undefined;
      scheduleSave();
    }
  }

  // ── Reconciliation on Node startup ──

  async function reconcile(): Promise<void> {
    loadFromDisk();
    for (const job of jobs.values()) {
      if (job.status === 'running' || job.status === 'paused') {
        if (job.pid && isProcessAlive(job.pid)) {
          // Reattach: rebuild bgTask + watcher around the still-running detached child
          job.bgTaskId = deps.bgTaskStart('whisper-asr',
            `Whisper: ${path.basename(job.videoRelPath)} (${job.language.toUpperCase()})`,
            `${job.percent} %`);
          if (job.status === 'running') runningCount++;
          startWatcher(job);
          console.log(`[whisper-jobs] Reattached to PID ${job.pid} for ${job.videoRelPath} (${job.percent}%)`);
        } else {
          job.status = 'interrupted';
          job.pid = null;
          job.error = 'Node wurde neugestartet während der Transkription lief und der Whisper-Prozess ist nicht mehr aktiv.';
          job.updatedAt = Date.now();
          console.log(`[whisper-jobs] Marked ${job.videoRelPath} as interrupted (PID ${job.pid} not alive)`);
        }
      }
    }
    scheduleSave();
    // Resume queue (any newly-eligible jobs after reconciliation)
    drainQueue();
  }

  // ── Public API ──

  function getJob(relPath: string): WhisperJob | null {
    return jobs.get(relPath) ?? null;
  }

  async function start(relPath: string, language: WhisperLanguage): Promise<WhisperJob> {
    const existing = jobs.get(relPath);
    if (existing) {
      if (existing.status === 'running' || existing.status === 'paused') {
        // Already in progress — return existing job; caller should pause/stop first
        return existing;
      }
      // Reuse the record: clear out old state, re-pend
      existing.status = 'pending';
      existing.phase = undefined;
      existing.percent = 0;
      existing.error = undefined;
      existing.transcriptPath = null;
      existing.pid = null;
      existing.language = language;
      existing.startedAt = Date.now();
      existing.phaseStartedAt = existing.startedAt;
      existing.updatedAt = existing.startedAt;
      // Clean only the previous-run JSON output (built fresh by finishJob from the log).
      // Keep the WAV (skips phase 1 re-extraction) AND the log (lets the next launch
      // resume whisper from the last completed segment via --offset).
      const { jsonPath } = paths(relPath, language);
      try { unlinkSync(jsonPath); } catch { /* ignore */ }
      jobs.set(relPath, existing);
    } else {
      const { logPath } = paths(relPath, language);
      jobs.set(relPath, {
        videoRelPath: relPath,
        language,
        status: 'pending',
        percent: 0,
        pid: null,
        startedAt: Date.now(),
        phaseStartedAt: Date.now(),
        updatedAt: Date.now(),
        transcriptPath: null,
        logPath,
        audioStreamIndex: -1,
      });
    }
    const job = jobs.get(relPath)!;
    if (runningCount < WHISPER_CONCURRENCY) {
      // Kick off in the background — do NOT await. The launch sets status='running' +
      // bgTaskId synchronously before its first `await`, so by the time control returns
      // here the job is already in the running state. Awaiting would block the HTTP
      // response on ~30s of ffmpeg WAV extraction, leaving the admin button stuck in its
      // disabled state until extraction finishes.
      void launch(job).catch(err => console.warn(`[whisper-jobs] launch error for ${relPath}: ${(err as Error).message}`));
    } else if (!pendingQueue.includes(relPath)) {
      pendingQueue.push(relPath);
    }
    scheduleSave();
    return job;
  }

  async function pause(relPath: string): Promise<WhisperJob> {
    const job = jobs.get(relPath);
    if (!job) throw new Error('Kein Job für dieses Video');
    if (job.status !== 'running' || !job.pid) return job;
    try {
      process.kill(job.pid, 'SIGSTOP');
      job.status = 'paused';
      job.updatedAt = Date.now();
      if (job.bgTaskId) deps.bgTaskUpdate(job.bgTaskId, `Pausiert · ${job.percent} %`);
      scheduleSave();
    } catch (err) {
      throw new Error(`SIGSTOP fehlgeschlagen: ${(err as Error).message}`);
    }
    return job;
  }

  async function resume(relPath: string): Promise<WhisperJob> {
    const job = jobs.get(relPath);
    if (!job) throw new Error('Kein Job für dieses Video');
    if (job.status !== 'paused' || !job.pid) return job;
    try {
      process.kill(job.pid, 'SIGCONT');
      job.status = 'running';
      job.updatedAt = Date.now();
      if (job.bgTaskId) deps.bgTaskUpdate(job.bgTaskId, `${job.percent} %`);
      scheduleSave();
    } catch (err) {
      throw new Error(`SIGCONT fehlgeschlagen: ${(err as Error).message}`);
    }
    return job;
  }

  async function stop(relPath: string): Promise<WhisperJob> {
    const job = jobs.get(relPath);
    if (!job) throw new Error('Kein Job für dieses Video');
    if (job.pid && isProcessAlive(job.pid)) {
      // SIGCONT first in case the process is paused — SIGTERM doesn't take effect on
      // a SIGSTOP'd process until it resumes.
      try { process.kill(job.pid, 'SIGCONT'); } catch { /* may not be paused */ }
      try { process.kill(job.pid, 'SIGTERM'); } catch { /* already gone */ }
      // Brutal fallback after 3s
      const pidToKill = job.pid;
      setTimeout(() => {
        if (isProcessAlive(pidToKill)) {
          try { process.kill(pidToKill, 'SIGKILL'); } catch { /* ignore */ }
        }
      }, 3000);
    }
    if (job.bgTaskId) deps.bgTaskDone(job.bgTaskId);
    job.bgTaskId = undefined;
    const wasRunning = job.status === 'running' || job.status === 'paused';
    job.status = 'pending';
    job.phase = undefined;
    job.percent = 0;
    job.pid = null;
    job.transcriptPath = null;
    job.error = undefined;
    job.updatedAt = Date.now();
    if (wasRunning) runningCount = Math.max(0, runningCount - 1);
    stopWatcher(relPath);
    // Clear partial outputs
    // Stop is a deliberate user cancel — clear all artifacts including the log so the
    // next start is from-scratch (no surprise resume from a job the user wanted to abandon).
    const { wavPath, jsonPath, logPath } = paths(relPath, job.language);
    for (const p of [wavPath, jsonPath, logPath]) { try { unlinkSync(p); } catch { /* ignore */ } }
    job.audioDurationSec = undefined;
    job.resumeOffsetMs = undefined;
    scheduleSave();
    drainQueue();
    return job;
  }

  async function readTranscript(relPath: string): Promise<unknown | null> {
    const job = jobs.get(relPath);
    if (!job || !job.transcriptPath) return null;
    try {
      const txt = await readFile(job.transcriptPath, 'utf8');
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }

  async function health(): Promise<{ ok: boolean; binPath: string | null; modelPath: string | null; reason?: string }> {
    const binPath = resolveBinary();
    const modelPath = resolveModel();
    if (!binPath) return { ok: false, binPath: null, modelPath, reason: 'whisper-cli wurde nicht gefunden — bitte `npm run whisper:install` ausführen' };
    if (!modelPath) return { ok: false, binPath, modelPath: null, reason: 'Whisper-Modell wurde nicht gefunden — bitte `npm run whisper:download-model` ausführen' };
    return { ok: true, binPath, modelPath };
  }

  return {
    reconcile,
    getAll: () => Array.from(jobs.values()),
    get: getJob,
    start,
    pause,
    resume,
    stop,
    readTranscript,
    health,
    flushSync,
  };
}

// ── Free-function helpers (exported for unit tests) ───────────────────────────

/** Parse `HH:MM:SS.mmm` (whisper.cpp's segment timestamp format) into milliseconds. */
function parseHmsMs(s: string): number {
  const m = /^(\d+):(\d+):(\d+)\.(\d+)$/.exec(s.trim());
  if (!m) return NaN;
  return (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 1000
    + parseInt(m[4], 10);
}

export interface WhisperLogSegment {
  /** Absolute milliseconds since the start of the audio file. */
  fromMs: number;
  toMs: number;
  text: string;
}

/**
 * Parse a whisper-cli log into absolute-time segments. Handles RESUME marker lines that
 * tell us "subsequent segment timestamps are relative to N ms" — produced by `launch()`
 * before each --offset spawn. The result is one continuous segment list with absolute
 * timestamps regardless of how many resume cycles produced the log.
 */
export function parseLogSegments(logText: string): WhisperLogSegment[] {
  const out: WhisperLogSegment[] = [];
  let currentOffsetMs = 0;
  for (const rawLine of logText.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.startsWith(RESUME_MARKER_PREFIX)) {
      const m = /(\d+)/.exec(line.slice(RESUME_MARKER_PREFIX.length));
      if (m) currentOffsetMs = parseInt(m[1], 10);
      continue;
    }
    // Segment line: "[HH:MM:SS.mmm --> HH:MM:SS.mmm]   <text>"
    const seg = /^\[([0-9:.]+)\s*-->\s*([0-9:.]+)\]\s*(.*)$/.exec(line);
    if (!seg) continue;
    const fromRel = parseHmsMs(seg[1]);
    const toRel = parseHmsMs(seg[2]);
    if (!Number.isFinite(fromRel) || !Number.isFinite(toRel)) continue;
    out.push({
      fromMs: fromRel + currentOffsetMs,
      toMs: toRel + currentOffsetMs,
      text: seg[3],
    });
  }
  return out;
}

/** Build a whisper.cpp-shaped JSON transcript ({ transcription: [{ offsets, text }] })
 *  from the parsed segments. Matches the shape that generate-hp-spells.ts already
 *  consumes — see scripts/lib/whisper-match.ts and the generator's flattenTranscript(). */
export function buildTranscriptJson(segments: WhisperLogSegment[]): { transcription: Array<{ offsets: { from: number; to: number }; text: string }> } {
  return {
    transcription: segments.map(s => ({
      offsets: { from: s.fromMs, to: s.toMs },
      text: s.text,
    })),
  };
}

/** True if a PID is alive on this host. Uses kill(pid, 0) which is a no-op signal. */
export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we don't have permission — treat as alive
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Cross-platform `which` (synchronous). Returns absolute path or null. */
export function whichSync(name: string): string | null {
  const PATH = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of PATH.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        const st = statSync(candidate);
        if (st.isFile()) return candidate;
      } catch { /* not here */ }
    }
  }
  return null;
}

