/**
 * Module-scope save queue for the admin CMS — see specs/admin-save-queue.md.
 *
 * Why this exists outside React: the admin panes are conditionally rendered
 * (AdminScreen has no router), so switching tabs UNMOUNTS the editor. A debounce
 * timer owned by a `useEffect` gets cleared by that effect's cleanup, which is
 * how a setting toggled and abandoned within 800 ms was silently discarded.
 * Here the timer, the request, the write-serialization and the retry all live at
 * module scope, so nothing a component does on unmount can cancel a write.
 *
 * One entry per key. Within a key: newest payload wins, writes never overlap, and
 * a transient failure retries with capped exponential backoff until it lands.
 * Across keys there is no ordering guarantee (config and a game file save in
 * parallel — they are different files).
 */

export const CONFIG_SAVE_KEY = 'config';
export const gameSaveKey = (fileName: string): string => `game:${fileName}`;

export type SaveQueueState = 'idle' | 'saving' | 'retrying' | 'error';

export interface SaveQueueStatus {
  state: SaveQueueState;
  /** Keys whose newest payload is not yet on disk. */
  unsavedKeys: number;
  /** A request is on the wire right now (as opposed to merely queued/debouncing). */
  inFlight: boolean;
  /** Consecutive failures of the worst entry; 0 when nothing is failing. */
  attempts: number;
  /** Epoch ms of the next automatic attempt; null unless `state === 'retrying'`. */
  nextRetryAt: number | null;
  lastError: string | null;
  lastSavedAt: number | null;
  offline: boolean;
}

export interface EnqueueOptions<T = unknown> {
  /** 0 runs immediately. Defaults to DEFAULT_DEBOUNCE_MS. */
  debounceMs?: number;
  /** Last-gasp keepalive write on `pagehide`, called with the newest payload. */
  beacon?: (payload: T) => void;
}

export const DEFAULT_DEBOUNCE_MS = 800;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;
const SELF_WRITE_TTL_MS = 5000;

type Timer = ReturnType<typeof setTimeout>;

interface Waiter {
  /** Resolve once a payload with at least this seq is persisted. */
  seq: number;
  resolve: () => void;
  reject: (err: unknown) => void;
}

interface Entry {
  key: string;
  payload: unknown;
  saver: (payload: unknown) => Promise<void>;
  beacon?: (payload: unknown) => void;
  /** Bumped on every enqueue. */
  seq: number;
  /** Seq of the last payload confirmed on disk. */
  savedSeq: number;
  debounceMs: number;
  timer: Timer | null;
  retryTimer: Timer | null;
  inFlight: boolean;
  attempts: number;
  nextRetryAt: number | null;
  lastError: string | null;
  /** Permanent failure (4xx) — no automatic retry until superseded or `retryNow`. */
  blocked: boolean;
  waiters: Waiter[];
}

const entries = new Map<string, Entry>();
/** JSON this tab has written recently, per key — echo suppression for `content-changed`. */
const selfWrites = new Map<string, Map<string, Timer>>();
/** Last payload confirmed on disk per key, with the time it landed. */
const lastSaved = new Map<string, { payload: unknown; json: string; at: number }>();

const statusListeners = new Set<(s: SaveQueueStatus) => void>();
const savedListeners = new Set<(key: string, json: string) => void>();

let lastSavedAt: number | null = null;
let listenersAttached = false;

// ── Status snapshot ──────────────────────────────────────────────────────────

// Cached on purpose: `useSyncExternalStore` compares snapshots by identity, so a
// getter that allocates a fresh object re-renders forever.
let statusSnapshot: SaveQueueStatus = {
  state: 'idle',
  unsavedKeys: 0,
  inFlight: false,
  attempts: 0,
  nextRetryAt: null,
  lastError: null,
  lastSavedAt: null,
  offline: false,
};

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function computeStatus(): SaveQueueStatus {
  let unsavedKeys = 0;
  let saving = false;
  let retrying = false;
  let blocked = false;
  let attempts = 0;
  let nextRetryAt: number | null = null;
  let lastError: string | null = null;

  for (const e of entries.values()) {
    if (e.savedSeq === e.seq) continue;
    unsavedKeys++;
    if (e.inFlight) saving = true;
    if (e.blocked) blocked = true;
    else if (e.retryTimer) retrying = true;
    if (e.attempts > attempts) attempts = e.attempts;
    // Not keyed off `attempts`: a blocked (4xx) entry never increments it, and its
    // message is exactly the one the operator needs to see.
    if (e.lastError && !lastError) lastError = e.lastError;
    if (e.nextRetryAt !== null && (nextRetryAt === null || e.nextRetryAt < nextRetryAt)) {
      nextRetryAt = e.nextRetryAt;
    }
  }

  // A save in flight reads as "saving" even if a previous attempt failed — the
  // operator cares that something is happening right now.
  const state: SaveQueueState = saving ? 'saving' : retrying ? 'retrying' : blocked ? 'error' : unsavedKeys > 0 ? 'saving' : 'idle';

  return {
    state,
    unsavedKeys,
    inFlight: saving,
    attempts,
    nextRetryAt: state === 'retrying' ? nextRetryAt : null,
    lastError: state === 'idle' ? null : lastError,
    lastSavedAt,
    offline: isOffline(),
  };
}

function sameStatus(a: SaveQueueStatus, b: SaveQueueStatus): boolean {
  return (
    a.state === b.state &&
    a.unsavedKeys === b.unsavedKeys &&
    a.inFlight === b.inFlight &&
    a.attempts === b.attempts &&
    a.nextRetryAt === b.nextRetryAt &&
    a.lastError === b.lastError &&
    a.lastSavedAt === b.lastSavedAt &&
    a.offline === b.offline
  );
}

function emit(): void {
  const next = computeStatus();
  if (sameStatus(next, statusSnapshot)) return;
  statusSnapshot = next;
  for (const fn of statusListeners) {
    try { fn(next); } catch { /* one listener must not break the rest */ }
  }
}

export function getStatus(): SaveQueueStatus {
  return statusSnapshot;
}

export function subscribe(fn: (s: SaveQueueStatus) => void): () => void {
  statusListeners.add(fn);
  return () => { statusListeners.delete(fn); };
}

/** Fires with `(key, JSON.stringify(payload))` each time a payload reaches disk. */
export function onSaved(fn: (key: string, json: string) => void): () => void {
  savedListeners.add(fn);
  return () => { savedListeners.delete(fn); };
}

// ── Self-write bookkeeping ───────────────────────────────────────────────────

function noteSelfWrite(key: string, json: string): void {
  let set = selfWrites.get(key);
  if (!set) { set = new Map(); selfWrites.set(key, set); }
  const existing = set.get(json);
  if (existing) clearTimeout(existing);
  set.set(json, setTimeout(() => { set.delete(json); }, SELF_WRITE_TTL_MS));
}

/**
 * Did this tab write exactly this JSON in the last ~5 s? Lives here rather than in
 * the editor so an echo of a save that completed AFTER its pane unmounted is still
 * recognised as ours.
 */
export function isRecentSelfWrite(key: string, json: string): boolean {
  return selfWrites.get(key)?.has(json) ?? false;
}

function recordPersisted(key: string, payload: unknown, json: string): void {
  noteSelfWrite(key, json);
  lastSaved.set(key, { payload, json, at: Date.now() });
  lastSavedAt = Date.now();
  for (const fn of savedListeners) {
    try { fn(key, json); } catch { /* one listener must not break the rest */ }
  }
}

/**
 * Record content the SERVER wrote for us (e.g. the convert-to-multi-instance and
 * instance-delete endpoints, which rewrite the file themselves) as persisted and
 * self-written, without issuing a PUT of our own.
 */
export function markSaved(key: string, payload: unknown): void {
  const e = entries.get(key);
  if (e) {
    e.payload = payload;
    e.seq++;
    e.savedSeq = e.seq;
    clearTimers(e);
    e.attempts = 0;
    e.lastError = null;
    e.blocked = false;
    resolveWaiters(e);
  }
  recordPersisted(key, payload, JSON.stringify(payload));
  emit();
}

// ── The queue ────────────────────────────────────────────────────────────────

function clearTimers(e: Entry): void {
  if (e.timer) { clearTimeout(e.timer); e.timer = null; }
  if (e.retryTimer) { clearTimeout(e.retryTimer); e.retryTimer = null; }
  e.nextRetryAt = null;
}

function resolveWaiters(e: Entry): void {
  if (e.waiters.length === 0) return;
  const done = e.waiters.filter(w => w.seq <= e.savedSeq);
  e.waiters = e.waiters.filter(w => w.seq > e.savedSeq);
  for (const w of done) w.resolve();
}

function rejectWaiters(e: Entry, err: unknown): void {
  const all = e.waiters;
  e.waiters = [];
  for (const w of all) w.reject(err);
}

/**
 * Worth another automatic attempt? Network failures (a bare `TypeError` from
 * `fetch`, or `ApiError` with the default status 0) and server-side/transient HTTP
 * codes are; a 4xx means the payload itself was rejected, so retrying it forever
 * would just hammer the server.
 */
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (typeof status !== 'number' || status === 0) return true;
  return status >= 500 || status === 408 || status === 429;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function maybeRun(e: Entry): void {
  if (e.inFlight || e.timer || e.retryTimer || e.blocked) return;
  if (e.savedSeq === e.seq) return;
  void run(e);
}

async function run(e: Entry): Promise<void> {
  const seqAtStart = e.seq;
  const payload = e.payload;
  const json = JSON.stringify(payload);
  e.inFlight = true;
  emit();
  try {
    await e.saver(payload);
    e.savedSeq = seqAtStart;
    e.attempts = 0;
    e.lastError = null;
    e.nextRetryAt = null;
    recordPersisted(e.key, payload, json);
    resolveWaiters(e);
  } catch (err) {
    e.lastError = errorMessage(err);
    rejectWaiters(e, err);
    if (isRetryable(err)) {
      e.attempts++;
      const delay = Math.min(RETRY_BASE_MS * 2 ** (e.attempts - 1), RETRY_MAX_MS);
      e.nextRetryAt = Date.now() + delay;
      e.retryTimer = setTimeout(() => {
        e.retryTimer = null;
        e.nextRetryAt = null;
        void run(e);
      }, delay);
    } else {
      e.blocked = true;
    }
  } finally {
    e.inFlight = false;
    emit();
    // A newer payload arrived while we were writing — send it now. Reading
    // `e.payload` fresh means only the newest one ever goes out.
    maybeRun(e);
  }
}

/**
 * Queue `payload` for `key`, debounced. Replaces any payload already queued for
 * that key — the newest one always wins.
 */
export function enqueueSave<T>(
  key: string,
  payload: T,
  saver: (payload: T) => Promise<void>,
  options?: EnqueueOptions<T>,
): void {
  attachLifecycleListeners();
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let e = entries.get(key);
  if (!e) {
    e = {
      key,
      payload,
      saver: saver as (p: unknown) => Promise<void>,
      seq: 0,
      savedSeq: 0,
      debounceMs,
      timer: null,
      retryTimer: null,
      inFlight: false,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      blocked: false,
      waiters: [],
    };
    entries.set(key, e);
  }
  const entry = e;
  entry.payload = payload;
  entry.saver = saver as (p: unknown) => Promise<void>;
  if (options?.beacon) entry.beacon = options.beacon as (p: unknown) => void;
  entry.debounceMs = debounceMs;
  entry.seq++;
  // A fresh payload deserves a fresh attempt even if the previous one was rejected.
  entry.blocked = false;
  if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
  if (entry.retryTimer) { clearTimeout(entry.retryTimer); entry.retryTimer = null; entry.nextRetryAt = null; }

  if (debounceMs <= 0) {
    maybeRun(entry);
  } else {
    entry.timer = setTimeout(() => {
      entry.timer = null;
      maybeRun(entry);
    }, debounceMs);
  }
  emit();
}

/**
 * Cancel the debounce and write now. Resolves once the payload that was newest at
 * call time (or a newer one) is on disk; rejects on the first failing attempt after
 * the call — the entry stays queued and keeps retrying regardless, so a rejection
 * means "not yet", not "given up".
 */
export function flushSave(key: string): Promise<void> {
  const e = entries.get(key);
  if (!e || e.savedSeq === e.seq) return Promise.resolve();
  const target = e.seq;
  const promise = new Promise<void>((resolve, reject) => {
    e.waiters.push({ seq: target, resolve, reject });
  });
  if (e.timer) { clearTimeout(e.timer); e.timer = null; }
  if (e.retryTimer) { clearTimeout(e.retryTimer); e.retryTimer = null; e.nextRetryAt = null; }
  e.blocked = false;
  maybeRun(e);
  emit();
  return promise;
}

export function flushAll(): Promise<void> {
  return Promise.all([...entries.keys()].map(k => flushSave(k).catch(() => { /* keeps retrying */ })))
    .then(() => undefined);
}

/** Drop a queued payload without writing it — the file was deleted or renamed away. */
export function discardSave(key: string): void {
  const e = entries.get(key);
  if (!e) return;
  clearTimers(e);
  e.savedSeq = e.seq;
  e.blocked = false;
  e.attempts = 0;
  e.lastError = null;
  resolveWaiters(e);
  entries.delete(key);
  emit();
}

/** Reset the backoff and attempt now — the indicator's retry button, and `online`. */
export function retryNow(key?: string): void {
  const targets = key ? [entries.get(key)].filter(Boolean) as Entry[] : [...entries.values()];
  for (const e of targets) {
    if (e.savedSeq === e.seq) continue;
    if (e.retryTimer) { clearTimeout(e.retryTimer); e.retryTimer = null; }
    if (e.timer) { clearTimeout(e.timer); e.timer = null; }
    e.nextRetryAt = null;
    e.attempts = 0;
    e.blocked = false;
    maybeRun(e);
  }
  emit();
}

export function hasPending(key?: string): boolean {
  if (key) {
    const e = entries.get(key);
    return !!e && e.savedSeq !== e.seq;
  }
  for (const e of entries.values()) if (e.savedSeq !== e.seq) return true;
  return false;
}

/** The payload currently queued for `key`, if any. */
export function peekPending<T>(key: string): T | undefined {
  const e = entries.get(key);
  return e && e.savedSeq !== e.seq ? (e.payload as T) : undefined;
}

/**
 * The newest payload this tab holds that a disk read *started* at `since` may have
 * missed — either still queued, or persisted while that read was in flight.
 * `undefined` means the read is authoritative.
 *
 * Needed because a GET issued by a newly mounted pane can be served BEFORE the
 * previous pane's queued PUT lands. Starting from that stale read would make the
 * new pane's first edit write the old pane's change away.
 */
export function newerThanRead<T>(key: string, since: number): T | undefined {
  const pending = peekPending<T>(key);
  if (pending !== undefined) return pending;
  const saved = lastSaved.get(key);
  if (saved && saved.at >= since) return saved.payload as T;
  return undefined;
}

// ── Browser lifecycle ────────────────────────────────────────────────────────

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') void flushAll();
}

function onPageHide(): void {
  for (const e of entries.values()) {
    if (e.savedSeq === e.seq) continue;
    clearTimers(e);
    // Fired for in-flight entries too: the browser aborts ordinary fetches on
    // unload, and both PUTs are whole-file atomic writes, so a duplicate is a no-op.
    try { e.beacon?.(e.payload); } catch { /* best effort */ }
  }
}

function onOnline(): void {
  retryNow();
}

function onBeforeUnload(ev: BeforeUnloadEvent): void {
  // Only when a save is actually failing. A merely pending save is already covered
  // by visibilitychange + the pagehide beacon, and prompting for it would nag.
  const s = getStatus();
  if (s.state === 'retrying' || s.state === 'error') ev.preventDefault();
}

// Attached lazily on the first enqueue, not at import time — this module is pulled
// into every test that touches the admin, and registering globals there would leak.
function attachLifecycleListeners(): void {
  if (listenersAttached) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  listenersAttached = true;
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', emit);
  window.addEventListener('beforeunload', onBeforeUnload);
}

/** Test helper: drop all queue state, timers and listeners. */
export function __resetSaveQueueForTests(): void {
  for (const e of entries.values()) {
    clearTimers(e);
    // Nobody is waiting on a torn-down queue; resolve so no unhandled rejection escapes.
    const waiters = e.waiters;
    e.waiters = [];
    for (const w of waiters) w.resolve();
  }
  entries.clear();
  for (const set of selfWrites.values()) for (const t of set.values()) clearTimeout(t);
  selfWrites.clear();
  lastSaved.clear();
  savedListeners.clear();
  statusListeners.clear();
  lastSavedAt = null;
  statusSnapshot = {
    state: 'idle',
    unsavedKeys: 0,
    inFlight: false,
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
    lastSavedAt: null,
    offline: false,
  };
  if (listenersAttached && typeof window !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', emit);
    window.removeEventListener('beforeunload', onBeforeUnload);
    listenersAttached = false;
  }
}
