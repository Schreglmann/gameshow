import { mulberry32 } from '@/utils/questions';

/**
 * Live-stable question ordering — see [specs/live-question-order.md](../../specs/live-question-order.md).
 *
 * A game's question list can change *while the game is being played* (the admin
 * CMS writes the file, the watcher broadcasts `content-changed`, `GameScreen`
 * re-fetches without remounting). Deriving the play order from
 * `randomizeQuestions(seed, length)` re-deals the whole deck the moment the
 * length changes, which loses track of which questions were already asked.
 *
 * Instead the play order is kept as an explicit list of **slots** and
 * reconciled against each new source array:
 *   - questions that survive keep their slot (and therefore their position),
 *   - genuinely new questions are appended at the end,
 *   - removed questions drop out and everything after them shifts down.
 *
 * Questions carry no id (see `src/types/config.ts`), so survival is decided by a
 * content diff. Everything in this module is pure — the per-game state lives in
 * [gamePlaythroughStore.ts](./gamePlaythroughStore.ts).
 */

/** Reserved slot id of source index 0, the "Beispiel" question. It is pinned to
 *  play position 0 and never takes part in the shuffle or the diff. */
export const EXAMPLE_SLOT_ID = 0;

/**
 * One position in a game's play order. `slotId` is minted when a question first
 * enters the order and is never reused — it is the question's stable identity
 * across live edits, independent of its shifting array index.
 */
interface QuestionSlot {
  slotId: number;
  /** Index into the game's `config.questions` array. */
  src: number;
}

export interface PlayOrder {
  seed: number;
  /** Fingerprints of the source array this order was reconciled against. */
  srcPrints: string[];
  /** The full play order, excluding source index 0. Holds every eligible
   *  question, including those currently outside `questionLimit` — that reserve
   *  is what refills the deck when a question is deleted. */
  slots: QuestionSlot[];
  /** The visible deck: `slots` capped at `questionLimit`. What the game plays. */
  deck: QuestionSlot[];
  /** Bumped only when the deck's slot sequence changed, i.e. only when the
   *  current question index actually needs remapping. A pure content edit
   *  produces a new `PlayOrder` with an unchanged `revision`. */
  revision: number;
  /** Where the *cursor* goes: `prevPlayIdx → newPlayIdx` for the transition that
   *  produced this order. A position whose question was deleted resolves to the
   *  position its successor moved into, so the next question slides in. Play
   *  index 0 is the example question and always maps to 0. */
  remap: number[];
  /** Where each *question* went: `prevPlayIdx → newPlayIdx`, or `null` if it was
   *  deleted. Unlike `remap` this never invents a destination — per-question data
   *  (the correct-answer tally) must not be re-attributed to a neighbour. */
  moved: (number | null)[];
  nextSlotId: number;
}

export interface ReconcileOptions {
  randomize?: boolean;
  /** `questionLimit` — counts questions *after* the example, matching `randomizeQuestions`. */
  limit?: number;
  seed: number;
}

// ── Fingerprints ──

/**
 * Stable content fingerprint of a question. Key-sorted, because the admin's
 * question forms rebuild objects via `{ ...next[i], ...patch }` plus `delete`,
 * so plain `JSON.stringify` would report spurious changes on key reordering.
 *
 * `undefined` values are dropped so an explicitly-cleared optional field
 * fingerprints the same as an absent one (that is how `JSON.stringify` and the
 * admin's own save path already treat them).
 */
export function stableFingerprint(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value)) ?? 'undefined';
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    // NB: the `JSON.stringify(v, keys)` replacer-array shortcut cannot be used
    // here — it *filters* keys at every nesting level, silently dropping fields.
    for (const key of Object.keys(value as object).sort()) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner === undefined) continue;
      out[key] = sortKeysDeep(inner);
    }
    return out;
  }
  return value;
}

// ── Diff ──

/**
 * Classifies how `next` differs from `prev` as a single structural edit. A pure
 * text edit / reorder / multi-change is reported as 'same' (equal) or 'complex'
 * so callers fall back to clamping (Ranking's progressive reveal) or to the
 * general anchored diff (this module) rather than mis-shifting.
 */
export type AnswerDiff =
  | { type: 'same' }
  | { type: 'complex' }
  | { type: 'removed'; index: number }
  | { type: 'added'; index: number };

export function diffSingleElement(prev: string[], next: string[]): AnswerDiff {
  if (prev.length === next.length) {
    return prev.every((v, i) => v === next[i]) ? { type: 'same' } : { type: 'complex' };
  }
  if (next.length === prev.length - 1) {
    let d = next.length; // default: the removed element was the last one
    for (let i = 0; i < next.length; i++) {
      if (prev[i] !== next[i]) { d = i; break; }
    }
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== prev[i < d ? i : i + 1]) return { type: 'complex' };
    }
    return { type: 'removed', index: d };
  }
  if (next.length === prev.length + 1) {
    let ins = prev.length; // default: the added element is at the end
    for (let i = 0; i < prev.length; i++) {
      if (next[i] !== prev[i]) { ins = i; break; }
    }
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== next[i < ins ? i : i + 1]) return { type: 'complex' };
    }
    return { type: 'added', index: ins };
  }
  return { type: 'complex' };
}

/**
 * Maps every index of the old source array to its index in the new one, or
 * `null` when that question is gone. Source index 0 (the "Beispiel") is pinned
 * to 0 and excluded from the diff — every game hardcodes `qIdx === 0` as the
 * example, so it must never migrate to another position.
 */
export function diffSources(oldPrints: string[], newPrints: string[]): (number | null)[] {
  const out: (number | null)[] = new Array(oldPrints.length).fill(null);
  if (oldPrints.length === 0 || newPrints.length === 0) return out;
  out[0] = 0;
  const tail = diffTail(oldPrints.slice(1), newPrints.slice(1));
  for (let i = 0; i < tail.length; i++) {
    const j = tail[i];
    out[i + 1] = j === null || j === undefined ? null : j + 1;
  }
  return out;
}

function diffTail(prev: string[], next: string[]): (number | null)[] {
  const single = diffSingleElement(prev, next);
  if (single.type === 'same') return prev.map((_, i) => i);
  if (single.type === 'removed') {
    const d = single.index;
    return prev.map((_, i) => (i === d ? null : i < d ? i : i - 1));
  }
  if (single.type === 'added') {
    const ins = single.index;
    return prev.map((_, i) => (i < ins ? i : i + 1));
  }
  return anchoredDiff(prev, next);
}

/**
 * General case, in two passes.
 *
 * **1 — exact matches.** Every fingerprint that is unique on *both* sides is
 * mapped to its twin, regardless of where it moved. Applying these
 * unconditionally (rather than only along a monotonic run, as a plain LCS would)
 * is what makes a pure reorder — the admin's "🔀 Fragen mischen" button — map
 * every question to its new home and leave a running deck completely untouched.
 * Restricting anchors to *unique* fingerprints is what makes the admin's
 * "duplizieren" button safe: byte-identical questions are common here, and an
 * LCS would happily pair the wrong copies.
 *
 * **2 — leftovers.** Whatever stayed unmatched is paired positionally inside the
 * brackets formed by the monotonic subset of pass 1. That pairing is what reads
 * as "this question was edited in place" (identity kept, stays where it is)
 * rather than "this one was deleted and a different one added" (identity lost,
 * the new one is appended at the end of the deck).
 */
function anchoredDiff(prev: string[], next: string[]): (number | null)[] {
  const nextFirst = new Map<string, number>();
  const nextCount = new Map<string, number>();
  next.forEach((k, i) => {
    nextCount.set(k, (nextCount.get(k) ?? 0) + 1);
    if (!nextFirst.has(k)) nextFirst.set(k, i);
  });
  const prevCount = new Map<string, number>();
  for (const k of prev) prevCount.set(k, (prevCount.get(k) ?? 0) + 1);

  const map: (number | null)[] = new Array(prev.length).fill(null);
  const matched: Array<[number, number]> = [];
  const usedNext = new Set<number>();
  prev.forEach((k, i) => {
    if (prevCount.get(k) === 1 && nextCount.get(k) === 1) {
      const j = nextFirst.get(k)!;
      map[i] = j;
      usedNext.add(j);
      matched.push([i, j]);
    }
  });

  const sentinel: [number, number] = [prev.length, next.length];
  let pi = 0;
  let ni = 0;
  for (const [ai, aj] of [...longestIncreasingByTarget(matched), sentinel]) {
    const oldGap: number[] = [];
    for (let i = pi; i < ai; i++) if (map[i] === null) oldGap.push(i);
    const newGap: number[] = [];
    for (let j = ni; j < aj; j++) if (!usedNext.has(j)) newGap.push(j);
    const pairs = Math.min(oldGap.length, newGap.length);
    for (let k = 0; k < pairs; k++) {
      map[oldGap[k]!] = newGap[k]!;
      usedNext.add(newGap[k]!);
    }
    pi = ai + 1;
    ni = aj + 1;
  }
  return map;
}

/**
 * Longest subsequence of `pairs` (already sorted by source index) whose target
 * indices strictly increase — anchors have to be monotonic to bracket gaps.
 * O(n²) DP: question lists run to tens of entries, and clarity wins here.
 */
function longestIncreasingByTarget(pairs: Array<[number, number]>): Array<[number, number]> {
  if (pairs.length === 0) return [];
  const best = new Array<number>(pairs.length).fill(1);
  const from = new Array<number>(pairs.length).fill(-1);
  let endAt = 0;
  for (let i = 1; i < pairs.length; i++) {
    for (let j = 0; j < i; j++) {
      if (pairs[j]![1] < pairs[i]![1] && best[j]! + 1 > best[i]!) {
        best[i] = best[j]! + 1;
        from[i] = j;
      }
    }
    if (best[i]! > best[endAt]!) endAt = i;
  }
  const out: Array<[number, number]> = [];
  for (let i = endAt; i !== -1; i = from[i]!) out.push(pairs[i]!);
  return out.reverse();
}

// ── Reconcile ──

/**
 * Folds a new source question array into the existing play order.
 *
 * Pass `prev = null` for the first deal. Returns the **same object** when
 * nothing relevant changed, which is what makes calling this during render
 * idempotent under StrictMode's double invocation.
 */
export function reconcileOrder<T extends { disabled?: boolean }>(
  prev: PlayOrder | null,
  questions: T[],
  opts: ReconcileOptions,
): PlayOrder {
  const srcPrints = questions.map(stableFingerprint);

  if (!prev) {
    const { slots, nextSlotId } = firstDeal(questions, opts);
    return finalize(null, opts.seed, srcPrints, slots, nextSlotId, opts.limit);
  }

  if (sameStrings(prev.srcPrints, srcPrints)) {
    // Content identical on disk; only a `questionLimit` change could still move
    // the deck, so run it through finalize (which returns `prev` if it doesn't).
    return finalize(prev, prev.seed, srcPrints, prev.slots, prev.nextSlotId, opts.limit);
  }

  const oldToNew = diffSources(prev.srcPrints, srcPrints);
  const survivors: QuestionSlot[] = [];
  const taken = new Set<number>();
  for (const slot of prev.slots) {
    const src = oldToNew[slot.src];
    // `src === 0` means this question became the example question — it leaves
    // the deck rather than being played twice.
    if (src === null || src === undefined || src === 0) continue;
    if (questions[src]?.disabled) continue;
    if (taken.has(src)) continue; // defensive: never play one question from two slots
    taken.add(src);
    survivors.push(slot.src === src ? slot : { slotId: slot.slotId, src });
  }

  // Genuinely new — and newly re-enabled — questions, in source order.
  const fresh: number[] = [];
  for (let i = 1; i < questions.length; i++) {
    if (questions[i]!.disabled) continue;
    if (!taken.has(i)) fresh.push(i);
  }

  let nextSlotId = prev.nextSlotId;
  const mint = (src: number): QuestionSlot => ({ slotId: nextSlotId++, src });

  let slots: QuestionSlot[];
  if (opts.randomize) {
    // Randomized game: the deck is ours, so survivors keep the order they were
    // dealt in and additions queue up at the end.
    slots = [...survivors, ...fresh.map(mint)];
  } else {
    // Ordered game: the file's order *is* the play order — an admin reorder must
    // apply live. Slot ids are carried over so the current question keeps its
    // identity and only its index moves.
    const bySrc = new Map(survivors.map(s => [s.src, s.slotId]));
    slots = [];
    for (let i = 1; i < questions.length; i++) {
      if (questions[i]!.disabled) continue;
      const slotId = bySrc.get(i);
      slots.push(slotId === undefined ? mint(i) : { slotId, src: i });
    }
  }

  return finalize(prev, prev.seed, srcPrints, slots, nextSlotId, opts.limit);
}

function firstDeal<T extends { disabled?: boolean }>(
  questions: T[],
  opts: ReconcileOptions,
): { slots: QuestionSlot[]; nextSlotId: number } {
  const eligible: number[] = [];
  for (let i = 1; i < questions.length; i++) {
    if (!questions[i]!.disabled) eligible.push(i);
  }
  if (opts.randomize) {
    // Same PRNG, same Fisher–Yates loop, same list length as `randomizeQuestions`
    // — a first deal is byte-identical to the pre-slot behaviour.
    const rand = mulberry32(opts.seed);
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j]!, eligible[i]!];
    }
  }
  return {
    slots: eligible.map((src, i) => ({ slotId: i + 1, src })),
    nextSlotId: eligible.length + 1,
  };
}

function finalize(
  prev: PlayOrder | null,
  seed: number,
  srcPrints: string[],
  slots: QuestionSlot[],
  nextSlotId: number,
  limit: number | undefined,
): PlayOrder {
  const deck = limit !== undefined && limit > 0 && limit < slots.length ? slots.slice(0, limit) : slots;
  const deckMoved = !prev || !sameSlotIds(prev.deck, deck);
  if (prev && !deckMoved && sameStrings(prev.srcPrints, srcPrints)) return prev;
  return {
    seed,
    srcPrints,
    slots,
    deck,
    revision: prev ? prev.revision + (deckMoved ? 1 : 0) : 0,
    ...buildRemap(prev ? prev.deck : deck, deck),
    nextSlotId,
  };
}

/**
 * Builds both mappings over play indices (0 = the example question).
 *
 * A surviving question maps to wherever it now sits, so deletions *before* the
 * current question pull it back by one and it stays on screen. For the cursor, a
 * question whose slot died resolves to the position its successor moved into —
 * the next question slides in where it stood. `moved` reports `null` there
 * instead, so per-question data attached to a deleted question is never silently
 * re-attributed to its neighbour.
 */
function buildRemap(
  prevDeck: QuestionSlot[],
  deck: QuestionSlot[],
): { remap: number[]; moved: (number | null)[] } {
  const posOf = new Map<number, number>();
  deck.forEach((s, i) => posOf.set(s.slotId, i));
  const remap = new Array<number>(prevDeck.length + 1);
  const moved = new Array<number | null>(prevDeck.length + 1);
  remap[0] = 0; // the example question never moves
  moved[0] = 0;
  let successor = deck.length; // a dead tail collapses onto the end of the deck
  for (let p = prevDeck.length; p >= 1; p--) {
    const j = posOf.get(prevDeck[p - 1]!.slotId);
    if (j === undefined) {
      remap[p] = successor;
      moved[p] = null;
    } else {
      remap[p] = j + 1;
      moved[p] = j + 1;
      successor = j + 1;
    }
  }
  return { remap, moved };
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameSlotIds(a: QuestionSlot[], b: QuestionSlot[]): boolean {
  return a.length === b.length && a.every((s, i) => s.slotId === b[i]!.slotId);
}

// ── Projection ──

/** The questions the game actually plays, in play order (index 0 = the example). */
export function playQuestions<T>(order: PlayOrder, questions: T[]): T[] {
  if (questions.length === 0) return [];
  return [questions[0]!, ...order.deck.map(s => questions[s.src]!)];
}

/**
 * `slotKeys[playIdx]` — the stable per-question key, unchanged by index shifts.
 * `sourceLength` mirrors `playQuestions`: with no questions there is no example
 * slot either.
 */
export function playSlotKeys(order: PlayOrder, sourceLength: number): number[] {
  return sourceLength === 0 ? [] : [EXAMPLE_SLOT_ID, ...order.deck.map(s => s.slotId)];
}
