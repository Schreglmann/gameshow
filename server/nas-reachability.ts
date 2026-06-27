/**
 * Freeze-proof NAS reachability + bounded NAS filesystem access.
 *
 * Background: the asset NAS (`NAS_BASE`, a network mount) can go *stale* — the
 * network drops but macOS hasn't torn the mount down yet. In that state any
 * `stat`/`readdir`/`read` against it blocks UNINTERRUPTIBLY in the kernel. A
 * synchronous such call on the main thread freezes Node's single event loop:
 * the server stops responding and the process can't even be killed (`kill -9`
 * cannot reap a thread parked in an uninterruptible I/O wait) until the syscall
 * returns. See specs/nas-freeze-resilience.md.
 *
 * This module guarantees the event loop NEVER blocks on the NAS:
 *  - `isNasReachable()` is a non-blocking cached flag, refreshed by a
 *    single-flight, timeout-bounded background probe. It never touches the
 *    filesystem on the caller's thread.
 *  - `nasStat` / `nasPathExists` are bounded async wrappers: each races the real
 *    `fs/promises` call against a timeout, so a stale mount degrades to
 *    "unavailable" instead of hanging. Because every NAS op in the codebase is
 *    issued sequentially and a bounded-op timeout immediately flips the cached
 *    flag to unreachable (short-circuiting subsequent guarded callers), at most
 *    a couple of libuv threadpool threads are ever parked on a dead mount — the
 *    event loop stays alive.
 */

import { stat } from 'fs/promises';
import type { Stats } from 'fs';
import { NAS_BASE } from './asset-paths.js';

const PROBE_TIMEOUT_MS = 4_000;
const OP_TIMEOUT_MS = 5_000;
const TTL_REACHABLE_MS = 5_000; // re-probe quickly while reachable to catch disconnects fast
const TTL_UNREACHABLE_MS = 60_000; // back off while unreachable to avoid hammering a dead mount

// Probing/timers are pointless (and would leak open handles) under vitest, where
// there is no real NAS. Mirrors the prior behaviour: statSync(NAS_BASE) threw →
// isNasMounted() was false.
const TEST_ENV = !!process.env.VITEST || process.env.NODE_ENV === 'test';

let cached: { value: boolean; ts: number } = { value: false, ts: 0 };
// Single-flight: held until the REAL stat settles (not just until the timeout
// resolves the result), so at most one threadpool thread probes a stale mount.
let probeInFlight: Promise<boolean> | null = null;

function now(): number {
  return Date.now();
}

function ttl(): number {
  return cached.value ? TTL_REACHABLE_MS : TTL_UNREACHABLE_MS;
}

/** Mark the NAS unreachable immediately (called when a bounded op times out, so
 *  the first stalled caller flips the flag and later guarded callers skip the
 *  NAS instead of each sticking another threadpool thread). */
export function markNasUnreachable(): void {
  cached = { value: false, ts: now() };
}

/**
 * Race a promise against a timeout. On timeout, resolve to `fallback` and run
 * `onTimeout` (used to flag the NAS unreachable). A *rejection* of `op` (e.g.
 * ENOENT — the file is genuinely absent) resolves fast to `fallback` WITHOUT
 * calling `onTimeout`: a missing file is not a stale mount.
 */
function withTimeout<T>(op: Promise<T>, ms: number, fallback: T, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      resolve(fallback);
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
    op.then(
      (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
      () => { if (settled) return; settled = true; clearTimeout(timer); resolve(fallback); },
    );
  });
}

/**
 * Single-flight reachability probe. The underlying `stat` may hang forever on a
 * stale mount; the RESULT is delivered via a timeout race after
 * `PROBE_TIMEOUT_MS`, but the single-flight slot is held until the real `stat`
 * settles — so at most ONE threadpool thread is ever parked on the dead mount.
 * When the stale mount is finally released/restored the stuck `stat` settles,
 * freeing the slot, and the next probe observes the new state.
 */
export function refreshNasReachable(): Promise<boolean> {
  if (TEST_ENV) return Promise.resolve(false);
  if (probeInFlight) return probeInFlight;

  const realStat = stat(NAS_BASE).then(
    (s) => s.isDirectory(),
    () => false,
  );
  // Authoritative result always wins eventually (even a late, post-timeout one),
  // and the slot frees only once the real stat settles.
  realStat.then(
    (value) => { cached = { value, ts: now() }; probeInFlight = null; },
    () => { probeInFlight = null; },
  );

  probeInFlight = withTimeout(realStat, PROBE_TIMEOUT_MS, false).then((value) => {
    cached = { value, ts: now() };
    return value;
  });
  return probeInFlight;
}

/**
 * Non-blocking reachability flag. Returns the last known value instantly and
 * never touches the filesystem on the calling thread; kicks off a background
 * refresh when the cache is stale.
 */
export function isNasReachable(): boolean {
  if (TEST_ENV) return false;
  if (now() - cached.ts >= ttl()) {
    void refreshNasReachable();
  }
  return cached.value;
}

/** Start the background reachability monitor (idempotent-ish; call once at boot). */
let monitorStarted = false;
export function startNasMonitor(): void {
  if (TEST_ENV || monitorStarted) return;
  monitorStarted = true;
  void refreshNasReachable();
  const timer = setInterval(() => { void refreshNasReachable(); }, TTL_REACHABLE_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

/** Bounded `stat` — resolves to `null` on absence OR on a stale-mount timeout. */
export function nasStat(p: string): Promise<Stats | null> {
  return withTimeout<Stats | null>(stat(p), OP_TIMEOUT_MS, null, markNasUnreachable);
}

/** Bounded existence check — `false` on absence OR on a stale-mount timeout. */
export async function nasPathExists(p: string): Promise<boolean> {
  return (await nasStat(p)) !== null;
}

/** Test-only: reset module state between vitest cases. */
export function _resetNasReachabilityForTests(): void {
  cached = { value: false, ts: 0 };
  probeInFlight = null;
  monitorStarted = false;
}
