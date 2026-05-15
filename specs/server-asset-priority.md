# Spec: Server-Side Asset-Serving Priority

## Goal

Audio and image requests issued by the show frontend during a live event must complete in milliseconds, never in seconds or minutes — even when the server is simultaneously running heavy background CPU work. File serving has absolute priority; background work runs only on leftover cycles.

**Primary background workload to tame: video-guess segment cache generation.** This is the only heavy CPU job that routinely runs during play (when the host advances to a new video question and a missing segment is encoded on demand, or when the next question's segment is pre-warmed). Whisper transcription and audio normalization are operator-triggered admin tasks done during prep, not during play — they get the same demotion as a consistency win, but the load-bearing path is the segment encoder.

## Acceptance criteria

- [x] Every background subprocess (ffmpeg + whisper-cli) is demoted with a platform-specific prefix that achieves the asymmetric goal: **use all available CPU when the system is idle, yield instantly when Express needs to serve a file**:
  - **Linux:** `nice -n 19` (CFS weight 7 vs 1024 at nice 0). Niced processes can use any core; the scheduler gives them essentially all idle CPU but preempts them the moment a nice-0 task needs cycles.
  - **macOS:** `taskpolicy -c utility`. Utility QoS allows BOTH P-cores and E-cores when the system is idle (unlike background QoS, which clamps to E-cores only on Apple Silicon — that made jobs crawl). Under contention, the Mach scheduler preempts utility-class work in favor of user-initiated work. Utility QoS does not imply I/O throttling.
  - **Windows:** no demotion. No equivalent without elevated rights, and the Windows scheduler handles foreground/background reasonably out of the box.
- [x] Background ffmpeg has no `-threads` cap. We want it to use every available core when idle and rely on the scheduler to shrink its CPU footprint under contention. Previous `-threads 2` cap limited even an idle system to ~2 cores of encoding throughput.
- [x] `BG_ENCODE_CONCURRENCY = 1` — at most one heavy ffmpeg encode runs at a time. Combined with the demotion above, the active encode runs flat-out when idle and is fully preemptible whenever Express needs CPU.
- [x] `server/index.ts` `spawnBackgroundFfmpeg()` is the single funnel for every video-segment / SDR-warmup / cache-generation ffmpeg call. Demotion lives in `bgProcessPrefix()` next to it.
- [x] `server/whisper-jobs.ts` `ffmpegThrottlePrefix()` (extraction step) and `throttlePrefix()` (whisper-cli compute step) both use `taskpolicy -c utility` on macOS so a 25-min whisper job no longer crawls on E-cores when the system is otherwise idle. Linux keeps `nice -n 19 ionice -c 3` for whisper-cli (the long compute can absorb I/O throttling) and `nice -n 19` for ffmpeg (sequential reads need full I/O bandwidth).
- [x] `server/normalize.ts` prefixes both `loudnorm` ffmpeg invocations with the same per-platform demotion. Previously had no priority demotion at all.
- [x] We deliberately do NOT use `-c background` (macOS) or `ionice -c 3` (Linux) for ffmpeg paths: both make the process unable to use P-cores / throttle disk I/O, which makes background work extremely slow even on an idle system. Background tasks should be cheap when not needed but fast when not contended.

## Mode toggle (operator-controlled)

The default discipline above (utility QoS + concurrency 1) is correct during a live show but holds back cache generation during prep windows when nothing else needs CPU. To let the operator opt into max throughput, the System tab exposes a `<select>` next to the cache controls with two modes:

- **Ausgewogen (balanced)** — default. Utility QoS / `nice -n 19`, `BG_ENCODE_CONCURRENCY = 1`. Playback always wins.
- **Maximum (max)** — no priority demotion, `BG_ENCODE_CONCURRENCY = 4`. Use all CPU, run multiple encodes in parallel. Operator's responsibility not to enable during a show.

### Mode-toggle acceptance criteria

- [ ] `encoding-prefs.json` at repo root persists `{ "cacheMode": "balanced" | "max" }`. Default `balanced` on first run / parse failure.
- [ ] `getCacheMode()` is re-read at every ffmpeg spawn so every trigger entry point (System tab buttons, admin/game-config warmup, frontend on-demand `/videos-compressed/...` cache miss, audio upload normalize, whisper transcription start) automatically inherits the current mode without code changes.
- [ ] `BG_ENCODE_CONCURRENCY` is a runtime getter, not a constant: returns 1 in balanced mode, 4 in max mode.
- [ ] `bgProcessPrefix()` / `ffmpegThrottlePrefix()` / `throttlePrefix()` / `getNicePrefix()` all return `[]` (or `''`) in max mode.
- [ ] Mode change via `PUT /api/backend/cache-mode` is **live**: the new mode applies immediately to in-flight processes too (no server restart, no waiting for the current encode to finish). Implementation: each module tracks active child PIDs in a `Set<number>`; the route handler iterates the set and re-applies priority via `taskpolicy -c <utility|default> -p <pid>` (macOS) or `renice -n <19|0> -p <pid>` (Linux). Errors (process exited mid-flip) are logged and ignored.
- [ ] Switching balanced→max immediately lets queued encodes start up to the new cap of 4 on the next `bgEncodeAcquire()` call.
- [ ] Switching max→balanced does not kill running encodes — the queue drains naturally to 1 as encodes finish.
- [ ] OpenAPI documents `GET`/`PUT /api/backend/cache-mode` under the backend tag.
- [ ] System tab `<select>` reflects the persisted mode on load, optimistically updates on change, and shows an inline warning while max mode is active.

## State / data changes

- New sidecar file at repo root: `encoding-prefs.json` = `{ "cacheMode": "balanced" | "max" }`.
- New HTTP routes: `GET /api/backend/cache-mode`, `PUT /api/backend/cache-mode`.
- No `AppState`, localStorage, or WS channel changes.

## Implementation

Files changed:
- [server/index.ts](../server/index.ts): new `bgProcessPrefix()` + `getBgEncodeConcurrency()` helpers, both mode-aware; PID `Set` for live re-pricing; `GET`/`PUT /api/backend/cache-mode` routes.
- [server/whisper-jobs.ts](../server/whisper-jobs.ts): `throttlePrefix()` and `ffmpegThrottlePrefix()` both consult `getCacheMode()`; child PID tracking + `reapplyWhisperPriority(mode)` export.
- [server/normalize.ts](../server/normalize.ts): switched from `exec()` to `spawn()` for PID access; `getNicePrefix()` consults `getCacheMode()`; `reapplyNormalizePriority(mode)` export.
- [server/encoding-prefs.ts](../server/encoding-prefs.ts) (new): `getCacheMode()` / `setCacheMode()` with sidecar JSON persistence.
- [src/services/backendApi.ts](../src/services/backendApi.ts): typed `getCacheMode()` / `setCacheMode()` client.
- [src/components/backend/SystemTab.tsx](../src/components/backend/SystemTab.tsx): `<select>` inside the Caches card with inline warning when max is active.
- [specs/api/openapi.yaml](api/openapi.yaml): `/api/backend/cache-mode` path + `CacheMode` schema.

## Verification

1. Generate sustained CPU load — kick off a fresh SDR warmup or compressed-cache batch over many video files via the admin DAM. With `BG_ENCODE_CONCURRENCY=1` one ffmpeg runs at a time, but it should still saturate the cores it gets.
2. Open the show frontend on a separate browser, navigate into an audio-heavy game (e.g. `gaming-soundtracks`, `film-soundtracks`, `emoji-raten`).
3. In DevTools → Network, verify every `/audio/...` and `/images/...` request completes in <500 ms even while background ffmpeg is running. Range-served audio files should reach `200`/`206` immediately, not after 30+ seconds.
4. Inspect `top` (Linux) or Activity Monitor (macOS): the niced ffmpeg processes should show priority 39 (Linux nice +19) / "Low" priority (macOS), and CPU% should drop to <5% the moment any other process needs cycles.

## Why these specific values

| Setting | Why |
|---------|-----|
| Linux: `nice -n 19` (not 10) | Linux CFS weight: nice 0 = 1024, nice 10 = 110, nice 19 = 7. The drop from 110 → 7 is what makes ffmpeg yield essentially the entire CPU to Node under contention. `-n 10` still gave ffmpeg ~10% even when Express needed it. |
| macOS: `taskpolicy -c utility` (not `-c background`, not `nice`) | macOS's Mach scheduler largely ignores BSD `nice` in favor of QoS classes — a niced process in user-initiated QoS still gets significant CPU. `-c background` is too aggressive: on Apple Silicon it pins the process to E-cores only, making encodes crawl even when the system is otherwise idle. `-c utility` is the sweet spot: process can use BOTH P-cores and E-cores when idle, but is preempted by user-initiated work (Express). No implicit I/O throttling, so `-d` is unnecessary. |
| `BG_ENCODE_CONCURRENCY=1` in balanced mode (was 2) | Two parallel encodes at full thread count would saturate every core. Combined with the demotion above, the kernel scheduler still mostly yields to Express — but serializing keeps total contention low and predictable. |
| `BG_ENCODE_CONCURRENCY=4` in max mode | Operator opt-in for "prep windows, no show running, go fast". Four parallel ffmpegs at full priority saturate all cores; the kernel scheduler distributes. Fixed at 4 to keep behavior predictable across machines (sweet spot for typical 10–14-core Macs). |
| CPU-only demotion (no I/O throttling for ffmpeg) | ffmpeg reads multi-GB videos sequentially. Throttled I/O (`ionice -c 3` on Linux, the implicit I/O policy of `-c background` on macOS) makes those reads block whenever the disk has anything else to do — which during a live show is constant (audio files being served). CPU is the contended resource, not disk. |
| Whisper itself keeps I/O throttle on Linux only | Whisper-cli is a 25-min CPU-bound job. On Linux it runs at `nice -n 19 ionice -c 3` — the WAV read happens upfront and I/O throttling pays off during the long compute. On macOS we settled on `taskpolicy -c utility` (not `-c background`) so the operator's whisper jobs no longer take hours when the system is otherwise idle. In max mode all priority demotion is removed regardless of platform. |

## Out of scope

- A worker-pool architecture (BullMQ, Redis-backed queues). The single-process Express server is fine for this scale; the bottleneck is CPU scheduling, not job orchestration.
- Adaptive concurrency (raising the encode cap when no clients are connected). Two-line change, but adds a "racy state" failure mode and isn't necessary — segments cache once-and-forever so encoding throughput is rarely the constraint.
- Pinning Express to a CPU core via `taskset` / `taskpolicy`. The kernel scheduler already does this well enough once the heavy processes are niced. Hardware pinning is a sledgehammer for a problem we've already solved with `nice`.
- Client-side resilience (retry, preload, recovery button) — covered separately by [asset-resilience.md](asset-resilience.md). That spec handles "the asset is genuinely missing"; this one handles "the server is too busy to send it fast enough".
