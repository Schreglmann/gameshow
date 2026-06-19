# Spec: NAS-freeze resilience

## Goal
The server's main-thread event loop must never block on NAS I/O, so a stale or
disconnected `/Volumes/Georg/Gameshow/Assets` mount degrades gracefully ("NAS
unavailable") instead of freezing the whole gameshow and producing an
unkillable process.

## Background
The asset NAS is a network mount. When it goes **stale** (network drops but
macOS hasn't torn the mount down yet), any `stat`/`readdir`/`read` against it
blocks **uninterruptibly in the kernel**. A *synchronous* such call on the main
thread freezes Node's single event loop — the server stops responding and the
process can't even be killed (`kill -9` cannot reap a thread parked in an
uninterruptible I/O wait) until the syscall returns.

The previous guard `isNasMounted()` used a **blocking** `statSync(NAS_BASE)`,
which itself hangs on a stale mount. It protected only against a *cleanly
unmounted* NAS (where `statSync` throws ENOENT instantly), not a stale one — so
the very guard meant to prevent the freeze was a primary cause of it. It fired
constantly (system-status polls, every queue tick, the 30s queue-retry timer,
the 5-min `periodicRescan`, and every video/asset request), so any NAS blip
during a live show froze the server.

## Acceptance criteria
- [x] No synchronous NAS filesystem call (`statSync`/`existsSync`/`readFileSync`/
      `writeFileSync`/`renameSync`/`readdirSync`/`rmSync` against a path under
      `NAS_BASE`) ever runs on the main thread.
- [x] `isNasMounted()` is non-blocking: it returns a cached boolean and never
      touches the filesystem on the calling thread.
- [x] A stale NAS mount is detected by a single-flight, timeout-bounded
      background probe; at most ONE libuv threadpool thread is ever parked on
      the probe.
- [x] Request-path NAS lookups (`resolveVideoPathWithNas`, `/api/video-sdr`
      warmup source-resolution, `/api/video-hdr`) return within a bounded time
      even when the NAS is stale, serving the existing fallbacks instead of
      hanging the HTTP response.
- [x] Sync-engine NAS I/O (`readSyncState`/`writeSyncState` for `NAS_BASE`,
      `pruneTrash`, `softDelete`) runs off the main thread (async `fs/promises`).
- [x] Sync-engine correctness is unchanged: atomic state writes (tmp + rename),
      operation order, deletion-safety layers, and all existing tests still hold.
- [x] CLI scripts (`scripts/diagnose-sync-drift.ts`, `scripts/push-drifted-to-nas.ts`)
      keep their own one-shot `isNasMounted` — out of scope (a hung one-shot CLI
      is not a frozen server).

## State / data changes
- New module `server/nas-reachability.ts`:
  - `isNasReachable(): boolean` — non-blocking cached flag (default `false`).
  - `refreshNasReachable(): Promise<boolean>` — single-flight bounded probe.
  - `startNasMonitor(): void` — background refresher (unref'd interval).
  - `nasStat(p): Promise<Stats | null>` / `nasPathExists(p): Promise<boolean>` —
    bounded async helpers (race `fs/promises` against a timeout; a timeout marks
    the NAS unreachable and returns the safe fallback). ENOENT (file genuinely
    absent) resolves fast to the fallback WITHOUT marking the NAS unreachable.
  - Disabled under vitest (`VITEST`/`NODE_ENV==='test'`): no probing, no timers,
    `isNasReachable()` returns `false` — matching the prior test behaviour where
    `statSync(NAS_BASE)` threw.
- No API, config, or localStorage changes. No new env vars.

## UI behaviour
- None directly. The admin System tab's `nasMounted` flag now reflects the
  non-blocking cached value (may lag a real disconnect by up to the probe TTL of
  5 s, vs. instantly-but-frozen before). Asset/video routes already render
  "Quelle nicht erreichbar" / prerendered-frame fallbacks when the NAS is
  unavailable; those paths now trigger on a bounded timeout instead of a hang.

## Out of scope
- The bidirectional sync algorithm and its deletion-safety layers (unchanged).
- A `GAMESHOW_DISABLE_NAS` opt-out flag (not needed once access is non-blocking).
- Recovering an already-wedged process (OS-level: reconnect/force-unmount/reboot).
- The CLI sync scripts' own blocking mount checks.
