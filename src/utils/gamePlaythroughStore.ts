import type { PlayOrder } from '@/utils/questionOrder';
import type { GamePhase } from '@/types/game';

/**
 * Per-tab playthrough store, keyed by the game's stable `gameId` (the gameRef,
 * e.g. "georgs-quiz/v1").
 *
 * Per game it keeps:
 *
 *  - the shuffle **seed**, so a game re-entered via back-navigation shows the
 *    same question order it was played in (see specs/game-back-review.md),
 *  - the reconciled **play order** ([PlayOrder](./questionOrder.ts)), so editing
 *    the running game's questions in the admin adds/removes questions without
 *    re-dealing the deck (see specs/live-question-order.md),
 *  - the **high-water mark** and the **cursor** (the question on screen).
 *
 * Storing the order — not just the seed — is what makes the guarantee survive a
 * *length* change: the seeded permutation alone depends on the list length, so
 * adding or removing a question used to re-shuffle everything.
 *
 * It also keeps the show's **position** (game index, gameId, phase). Everything
 * is written through to the tab's `sessionStorage`, so a reload of the show tab
 * reopens the same game, phase and question in the same order (the boot-resume
 * token below). `sessionStorage` rather than `localStorage`: it is per tab, so a
 * spare show tab never overwrites the projector's position. This module persists
 * itself, like `saveQueue` — it is a utility store, not React state; teams and
 * points still go through the reducer. See specs/crash-recovery.md.
 */
interface PlaythroughEntry {
  seed: number;
  order: PlayOrder | null;
  /** Furthest play index reached this playthrough. Back-review resumes here so
   *  it never opens on a question that was appended after the game was played. */
  highWater: number;
  /** Play index currently on screen — where a reload resumes. */
  cursor: number;
}

export interface ShowPosition {
  gameIndex: number;
  gameId: string;
  phase: GamePhase;
}

/** What a reload resumes: the saved position plus the question it was on. */
export interface BootResume extends ShowPosition {
  cursor: number;
}

const STORAGE_KEY = 'show:playthrough';

const entries = new Map<string, PlaythroughEntry>();
let position: ShowPosition | null = null;
let bootResume: BootResume | null = null;

const PHASES: readonly GamePhase[] = ['landing', 'rules', 'game', 'points'];

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function persist(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ entries: [...entries], position }));
  } catch { /* quota / privacy mode — the in-memory store still works */ }
}

/** Parses the stored snapshot. Anything malformed is dropped, never thrown. */
export function parseSnapshot(raw: string | null): { entries: Map<string, PlaythroughEntry>; position: ShowPosition | null } {
  const out = { entries: new Map<string, PlaythroughEntry>(), position: null as ShowPosition | null };
  if (!raw) return out;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return out; }
  if (!parsed || typeof parsed !== 'object') return out;
  const { entries: rawEntries, position: rawPos } = parsed as { entries?: unknown; position?: unknown };
  if (Array.isArray(rawEntries)) {
    for (const pair of rawEntries) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || !pair[1] || typeof pair[1] !== 'object') continue;
      const e = pair[1] as Partial<PlaythroughEntry>;
      if (typeof e.seed !== 'number') continue;
      const order = e.order && typeof e.order === 'object' && Array.isArray((e.order as PlayOrder).slots) ? e.order : null;
      out.entries.set(pair[0], {
        seed: e.seed,
        order,
        highWater: isNonNegInt(e.highWater) ? e.highWater : 0,
        cursor: isNonNegInt(e.cursor) ? e.cursor : 0,
      });
    }
  }
  if (rawPos && typeof rawPos === 'object') {
    const p = rawPos as Partial<ShowPosition>;
    if (isNonNegInt(p.gameIndex) && typeof p.gameId === 'string' && p.gameId && PHASES.includes(p.phase as GamePhase)) {
      out.position = { gameIndex: p.gameIndex, gameId: p.gameId, phase: p.phase as GamePhase };
    }
  }
  return out;
}

/** Loads the tab's snapshot and arms the boot-resume token. Runs once at module load. */
export function hydratePlaythroughStore(): void {
  const store = storage();
  let raw: string | null = null;
  try { raw = store?.getItem(STORAGE_KEY) ?? null; } catch { raw = null; }
  const snap = parseSnapshot(raw);
  entries.clear();
  for (const [k, v] of snap.entries) entries.set(k, v);
  position = snap.position;
  bootResume = position
    ? { ...position, cursor: entries.get(position.gameId)?.cursor ?? 0 }
    : null;
}

hydratePlaythroughStore();

function entryFor(gameId: string, gen: () => number): PlaythroughEntry {
  let entry = entries.get(gameId);
  if (!entry) {
    entry = { seed: gen(), order: null, highWater: 0, cursor: 0 };
    entries.set(gameId, entry);
    persist();
  }
  return entry;
}

/**
 * Returns the stored shuffle seed for `gameId`, generating and storing one via
 * `gen` on first request. Subsequent calls (including after a component remount
 * or a reload of the tab) return the same seed, so the deal reproduces the
 * identical order.
 */
export function getStableSeed(gameId: string, gen: () => number): number {
  return entryFor(gameId, gen).seed;
}

/** The play order stored for `gameId`, or `null` before the first deal. */
export function getPlayOrder(gameId: string, gen: () => number): PlayOrder | null {
  return entryFor(gameId, gen).order;
}

/** Stores the reconciled play order for `gameId`. */
export function setPlayOrder(gameId: string, order: PlayOrder): void {
  const entry = entries.get(gameId);
  // `reconcileOrder` returns the same object when nothing changed, so this
  // writes storage only on a real change (it runs during render).
  if (entry && entry.order !== order) {
    entry.order = order;
    persist();
  }
}

/** The furthest play index reached for `gameId` this session. */
export function getHighWater(gameId: string): number {
  return entries.get(gameId)?.highWater ?? 0;
}

/**
 * Records that play index `playIdx` of `gameId` is on screen: it becomes the
 * reload cursor and raises the high-water mark (never lowers it).
 */
export function noteHighWater(gameId: string, playIdx: number): void {
  const entry = entries.get(gameId);
  if (!entry) return;
  const changed = entry.cursor !== playIdx || playIdx > entry.highWater;
  entry.cursor = playIdx;
  if (playIdx > entry.highWater) entry.highWater = playIdx;
  if (changed) persist();
}

/**
 * Records which game the show is on. Called by `GameScreen` whenever a game's
 * data arrives. A different game starts at its title screen; the same game
 * (a live refresh) keeps its recorded phase.
 */
export function setShowPosition(gameIndex: number, gameId: string): void {
  if (position && position.gameIndex === gameIndex && position.gameId === gameId) return;
  position = { gameIndex, gameId, phase: 'landing' };
  persist();
}

/** Records the phase of the game at `gameIndex`, if it is the current position. */
export function noteShowPhase(gameIndex: number, phase: GamePhase): void {
  if (!position || position.gameIndex !== gameIndex || position.phase === phase) return;
  position = { ...position, phase };
  persist();
}

/** The current saved position. Exposed for tests. */
export function getShowPosition(): ShowPosition | null {
  return position;
}

/**
 * The boot-resume token: set once when the tab loads with a saved position,
 * and only valid for the first game opened after that reload, until its
 * starting phase is left. Read without side effects (safe during render).
 */
export function peekBootResume(): BootResume | null {
  return bootResume;
}

/** The phase a reload resumes the game at `gameIndex` in, or null. */
export function bootResumePhase(gameIndex: number): GamePhase | null {
  return bootResume && bootResume.gameIndex === gameIndex ? bootResume.phase : null;
}

/** The question a reload resumes `gameId` at, or null (only in the game phase). */
export function bootResumeCursor(gameId: string | undefined): number | null {
  if (!gameId || !bootResume || bootResume.gameId !== gameId || bootResume.phase !== 'game') return null;
  return bootResume.cursor;
}

/** Drops the boot-resume token: the resumed game was left or never matched. */
export function clearBootResume(): void {
  bootResume = null;
}

/** Clears all stored playthrough state, in memory and in storage. Exposed for tests. */
export function clearPlaythroughStore(): void {
  entries.clear();
  position = null;
  bootResume = null;
  try { storage()?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
