# Spec: Whisper transcription jobs (per-video, admin-controlled)

## Goal

Let the operator transcribe any video in the DAM with Whisper directly from the admin UI:
start, pause, resume, stop, and watch live progress. Jobs persist across browser reloads
**and** Node server restarts. Transcripts are cached on disk and synced to the NAS so they
stay available across workstations and re-clones.

The immediate consumer is the Harry Potter spells generator (see
[hp-spells-generation.md](hp-spells-generation.md)) — but the feature is generic, applicable
to any video.

## Acceptance criteria

- [x] A "Transkription (Whisper)" panel appears in the video detail modal of the DAM
  (Assets → Videos → click a video). NOT shown on the videos overview grid.
- [x] Operator picks a language (Englisch / Deutsch) and starts a transcription. Whisper
  consumes the corresponding audio stream of the video.
- [x] While running, the panel shows a live progress bar driven by whisper-cli's
  `--print-progress` output, surfaced through the existing `system-status` WebSocket channel.
- [x] Pause sends `SIGSTOP` to the child PID; the percentage stops advancing. Resume sends
  `SIGCONT`; the percentage continues from where it left off. Stop sends `SIGTERM` (with a
  3-second `SIGKILL` fallback) and the panel returns to the start state.
- [x] Closing the modal or hard-refreshing the admin tab does not disturb the job — on
  re-open the panel re-hydrates from `GET /whisper/status?path=…`.
- [x] Restarting the Node server does not kill the whisper child (spawned with
  `detached: true` + `.unref()` and stdio piped to a log file). On the next start, the
  server reattaches by checking PID liveness via `kill(pid, 0)` and tailing the same log.
  Jobs whose PID died during the restart are marked `interrupted`.
- [x] Concurrency cap (default 1, override via `WHISPER_CONCURRENCY` env var). Excess
  starts queue as `pending` and drain FIFO.
- [x] Cross-platform: macOS (Apple Silicon + Intel) and Linux. Throttle wrapper is
  `taskpolicy -c background` on macOS, `nice -n 19 ionice -c 3` on Linux. POSIX signals
  for pause/resume/stop work identically on both.
- [x] Whisper binary is resolved via fallback chain: `WHISPER_CPP_BIN` env var →
  `local-assets/.whisper-build/whisper-cli` → system `PATH` (`whisper-cli`, `whisper-cpp`,
  `whisper`). Any of: project-local build, Homebrew install, apt install, custom path.
- [x] If the binary or model is missing, the panel shows a setup hint instead of the
  Start button (`/whisper/health` returns `ok: false`).
- [x] German UI throughout (per AGENTS.md §7).

## State / data changes

### Persistent

`local-assets/videos/.whisper-cache/jobs.json` — keyed by relative video path:

```ts
interface WhisperJob {
  videoRelPath: string;
  language: 'en' | 'de';
  status: 'pending' | 'running' | 'paused' | 'done' | 'error' | 'interrupted';
  percent: number;             // 0-100
  pid: number | null;
  startedAt: number;
  updatedAt: number;
  transcriptPath: string | null; // set when status === 'done'
  logPath: string;
  audioStreamIndex: number;
  error?: string;
}
```

The JSON file is in the DAM tier so `npm run sync:push` mirrors it (and the cached
transcripts) to the NAS — restoring on a fresh clone via `sync:pull` recovers historical
transcriptions without re-running Whisper.

Per-job artifacts in the same directory:
- `<slug>__<lang>.wav` — extracted audio (deleted on `done`)
- `<slug>__<lang>.json` — Whisper transcript output (the consumer)
- `<slug>__<lang>.log` — whisper-cli stdout/stderr tee (used by the progress watcher)

`<slug>` = `cacheSlug(videoRelPath).replace(/\.[^.]+$/, '')` — same convention as the
existing video segment caches in [server/index.ts](../server/index.ts).

### Runtime

The job manager exposes a `WhisperJobsApi` (see
[server/whisper-jobs.ts](../server/whisper-jobs.ts)). On startup the server calls
`reconcile()` which loads `jobs.json`, probes each running/paused job's PID, and either
re-attaches a progress watcher or marks the job `interrupted`.

### `BackgroundTask`

Adds `'whisper-asr'` to the `BackgroundTask['type']` union in
[server/index.ts](../server/index.ts). Whisper jobs surface in the existing SystemTab via
the `system-status` WebSocket channel — no new channel needed. The frontend
[VideoTranscriptionPanel](../src/components/backend/VideoTranscriptionPanel.tsx) reads the
matching `backgroundTask` for live progress.

## API

All under `/api/backend/assets/videos/whisper/`:

| Route | Method | Body / Query | Returns |
|---|---|---|---|
| `/health` | GET | — | `{ ok, binPath, modelPath, reason? }` |
| `/jobs` | GET | — | `{ jobs: WhisperJob[] }` |
| `/status` | GET | `?path=<rel>` | `{ job: WhisperJob \| null }` |
| `/transcript` | GET | `?path=<rel>` | raw JSON transcript (404 if absent) |
| `/start` | POST | `{ path, language: 'en' \| 'de' }` | `{ job }` |
| `/pause` | POST | `{ path }` | `{ job }` |
| `/resume` | POST | `{ path }` | `{ job }` |
| `/stop` | POST | `{ path }` | `{ job }` |

Live progress flows over the existing `system-status` WebSocket channel (filter
`backgroundTasks` for `type === 'whisper-asr'` and a label matching the basename + lang).

## UI behaviour

Component: [src/components/backend/VideoTranscriptionPanel.tsx](../src/components/backend/VideoTranscriptionPanel.tsx)

Rendered inside the existing video detail modal in
[AssetsTab.tsx](../src/components/backend/AssetsTab.tsx).

State variants:

- **Setup missing:** install hint `npm run whisper:install` (binary or model not found).
- **No job (or `pending` / `done` / `error` / `interrupted`):** language picker + a Start
  button. Done shows a "Transkript öffnen" link. Interrupted shows the reason.
- **Running:** progress bar + Pause + Stop. Live percent via WS.
- **Paused:** progress bar (frozen) + Resume + Stop.

Italic note on the running state: "Läuft im Hintergrund weiter, auch wenn der Tab
geschlossen oder der Node-Server neu gestartet wird."

## Setup

Operator runs once per workstation:

```bash
npm run whisper:install            # macOS: brew install OR build from source
                                   # Linux: clone + cmake + make
npm run whisper:download-model     # ~1.5 GB ggml-large-v3-turbo into local-assets/videos/.whisper-cache/models/
```

Override the model file via `WHISPER_MODEL_NAME` env var (e.g. `ggml-base.bin` for faster
but less accurate transcription on slow machines).

Override the binary via `WHISPER_CPP_BIN` env var if you want a specific build.

## Out of scope

- **Resumable mid-file transcription.** A `SIGKILL`'d job restarts from 0% — the
  `--offset` flag is not used. Detached spawn already protects against the common case
  (Node restart). For machine reboots, accept the 25-min hit.
- **Subtitle export (.srt, .vtt).** Raw word-timestamp JSON only.
- **Translation.** Audio language is transcribed verbatim.
- **Speaker diarisation.**
- **Whisper for audio-only DAM files.** Endpoints accept any `videoRelPath` but the UI
  panel only shows in the videos category modal.
- **GPU forcing.** whisper.cpp picks Metal automatically on macOS arm64 and CUDA on Linux
  with NVIDIA. `--no-gpu` is exposed via env var (`WHISPER_NO_GPU=1`) for users who need
  CPU-only.
