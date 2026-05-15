# Spec: Server-Side Asset-Serving Priority

## Goal

Audio and image requests issued by the show frontend during a live event must complete in milliseconds, never in seconds or minutes — even when the server is simultaneously running heavy background CPU work (video segment encoding, Whisper transcription, audio normalization, cache warm-ups). File serving has absolute priority; background work runs only on leftover cycles.

## Acceptance criteria

- [x] Every background ffmpeg subprocess is demoted with a platform-specific prefix that maxes out CPU yield while keeping I/O at normal priority:
  - **Linux:** `nice -n 19` (CFS weight 7 vs 1024 at nice 0). Scheduler yields ≥99% of CPU to Node under contention.
  - **macOS:** `taskpolicy -c background -d default`. BSD `nice` alone is too weak on macOS — the Mach scheduler favors QoS classes over nice values. `-c background` clamps the process to the background QoS class (heavy CPU demotion); `-d default` overrides the implicit I/O throttling that background QoS would otherwise apply.
  - **Windows:** no demotion. No equivalent exists without elevated rights, and the Windows scheduler handles foreground/background reasonably out of the box.
- [x] `BG_ENCODE_CONCURRENCY = 1` — at most one heavy ffmpeg encode runs at a time. Combined with the demotion above, the active encode is fully preemptible whenever Express needs CPU.
- [x] `server/index.ts` `spawnBackgroundFfmpeg()` is the single funnel for every video-segment / SDR-warmup / cache-generation ffmpeg call. Demotion lives in `bgProcessPrefix()` next to it.
- [x] `server/whisper-jobs.ts` `ffmpegThrottlePrefix()` matches the same per-platform demotion for the WAV extraction step. Whisper itself (the long CPU-bound transcription step) stays on the stronger `taskpolicy -c background` (macOS, without `-d default`) / `nice -n 19 ionice -c 3` (Linux) — its 25-min run can absorb I/O throttling.
- [x] `server/normalize.ts` prefixes both `loudnorm` ffmpeg invocations with the same per-platform demotion. Previously had none.
- [x] CPU-only demotion for ffmpeg — we deliberately keep I/O at default. ffmpeg reads multi-GB files sequentially; throttling I/O makes a 1-min encode crawl to 10+ min for no CPU benefit.

## State / data changes

None. Pure subprocess-spawn flag changes.

## Implementation

Three call sites changed:
- [server/index.ts](../server/index.ts): new `bgProcessPrefix()` helper, plumbed into `spawnBackgroundFfmpeg`; `BG_ENCODE_CONCURRENCY` `2` → `1`.
- [server/whisper-jobs.ts](../server/whisper-jobs.ts) `ffmpegThrottlePrefix()`: switched from `nice -n 10` (POSIX-uniform) to per-platform — `taskpolicy -c background -d default` on macOS, `nice -n 19` on Linux.
- [server/normalize.ts](../server/normalize.ts): both `loudnorm` analyze + encode commands prefixed with the per-platform string (`taskpolicy -c background -d default ` on macOS, `nice -n 19 ` on Linux).

## Verification

1. Generate sustained CPU load — kick off a fresh SDR warmup or compressed-cache batch over many video files via the admin DAM. With `BG_ENCODE_CONCURRENCY=1` one ffmpeg runs at a time, but it should still saturate the cores it gets.
2. Open the show frontend on a separate browser, navigate into an audio-heavy game (e.g. `gaming-soundtracks`, `film-soundtracks`, `emoji-raten`).
3. In DevTools → Network, verify every `/audio/...` and `/images/...` request completes in <500 ms even while background ffmpeg is running. Range-served audio files should reach `200`/`206` immediately, not after 30+ seconds.
4. Inspect `top` (Linux) or Activity Monitor (macOS): the niced ffmpeg processes should show priority 39 (Linux nice +19) / "Low" priority (macOS), and CPU% should drop to <5% the moment any other process needs cycles.

## Why these specific values

| Setting | Why |
|---------|-----|
| Linux: `nice -n 19` (not 10) | Linux CFS weight: nice 0 = 1024, nice 10 = 110, nice 19 = 7. The drop from 110 → 7 is what makes ffmpeg yield essentially the entire CPU to Node under contention. `-n 10` still gave ffmpeg ~10% even when Express needed it. |
| macOS: `taskpolicy -c background -d default` (not `nice`) | macOS's Mach scheduler largely ignores BSD `nice` in favor of QoS classes. A process at `nice -n 19` but in user-initiated QoS still gets significant CPU. `-c background` clamps the QoS class to background (CPU priority drops by ~16 priority levels). `-d default` is the critical fix: background QoS would otherwise imply throttled disk I/O, which would crawl ffmpeg's sequential reads. |
| `BG_ENCODE_CONCURRENCY=1` (not 2) | Two parallel encodes at `-threads 2` each = 4 saturated cores. Even with strong demotion, on a 4-core machine that leaves Node fighting for one core. Serializing means at most 2 cores are pinned, leaving ≥2 free for Node + Express. |
| CPU-only demotion (no I/O throttling for ffmpeg) | ffmpeg reads multi-GB videos sequentially. Throttled I/O (`ionice -c 3` on Linux, the implicit I/O policy of `-c background` on macOS) makes those reads block whenever the disk has anything else to do — which during a live show is constant (audio files being served). CPU is the contended resource, not disk. |
| Whisper itself keeps full background+I/O throttle | Whisper is a 25-min CPU-bound job that reads one WAV upfront and then computes. I/O throttling costs ~5 seconds upfront and saves a lot of disk contention during the long compute phase. The trade-off is opposite to ffmpeg's, which is why Whisper itself runs at `taskpolicy -c background` (macOS) / `nice -n 19 ionice -c 3` (Linux) while its ffmpeg extraction step does not. |

## Out of scope

- A worker-pool architecture (BullMQ, Redis-backed queues). The single-process Express server is fine for this scale; the bottleneck is CPU scheduling, not job orchestration.
- Adaptive concurrency (raising the encode cap when no clients are connected). Two-line change, but adds a "racy state" failure mode and isn't necessary — segments cache once-and-forever so encoding throughput is rarely the constraint.
- Pinning Express to a CPU core via `taskset` / `taskpolicy`. The kernel scheduler already does this well enough once the heavy processes are niced. Hardware pinning is a sledgehammer for a problem we've already solved with `nice`.
- Client-side resilience (retry, preload, recovery button) — covered separately by [asset-resilience.md](asset-resilience.md). That spec handles "the asset is genuinely missing"; this one handles "the server is too busy to send it fast enough".
