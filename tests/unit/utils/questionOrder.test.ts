import { describe, it, expect } from 'vitest';
import {
  stableFingerprint,
  diffSources,
  diffSingleElement,
  reconcileOrder,
  playQuestions,
  playSlotKeys,
  EXAMPLE_SLOT_ID,
  type PlayOrder,
} from '@/utils/questionOrder';

interface Q { question: string; disabled?: boolean }

const q = (question: string, disabled?: boolean): Q =>
  disabled === undefined ? { question } : { question, disabled };

/** Source list with a leading example question, e.g. src('A', 'B') → [Beispiel, A, B]. */
const src = (...names: string[]): Q[] => [q('Beispiel'), ...names.map(n => q(n))];

/** The played question texts, in play order. */
const played = (order: PlayOrder, questions: Q[]): string[] =>
  playQuestions(order, questions).map(x => x.question);

const SEED = 0xc0ffee;

describe('stableFingerprint', () => {
  it('is independent of key order', () => {
    expect(stableFingerprint({ a: 1, b: 2 })).toBe(stableFingerprint({ b: 2, a: 1 }));
  });

  it('sorts keys at every nesting level', () => {
    const a = { outer: { z: 1, a: [{ y: 2, x: 3 }] } };
    const b = { outer: { a: [{ x: 3, y: 2 }], z: 1 } };
    expect(stableFingerprint(a)).toBe(stableFingerprint(b));
  });

  it('treats an explicitly-undefined field as absent', () => {
    expect(stableFingerprint({ a: 1, b: undefined })).toBe(stableFingerprint({ a: 1 }));
  });

  it('still distinguishes different content', () => {
    expect(stableFingerprint({ a: 1 })).not.toBe(stableFingerprint({ a: 2 }));
  });

  it('does not confuse a null field with an absent one', () => {
    expect(stableFingerprint({ a: null })).not.toBe(stableFingerprint({}));
  });
});

describe('diffSources', () => {
  const prints = (...names: string[]) => names;

  it('pins source index 0 (the Beispiel) to 0', () => {
    expect(diffSources(prints('ex', 'A'), prints('ex2', 'A'))[0]).toBe(0);
  });

  it('maps positionally when a question is edited in place', () => {
    expect(diffSources(prints('ex', 'A', 'B', 'C'), prints('ex', 'A', 'B*', 'C')))
      .toEqual([0, 1, 2, 3]);
  });

  it('drops a removed question and shifts the rest down', () => {
    expect(diffSources(prints('ex', 'A', 'B', 'C'), prints('ex', 'A', 'C')))
      .toEqual([0, 1, null, 2]);
  });

  it('shifts up around an inserted question', () => {
    expect(diffSources(prints('ex', 'A', 'B'), prints('ex', 'A', 'NEW', 'B')))
      .toEqual([0, 1, 3]);
  });

  it('follows a pure reorder so no question is treated as new', () => {
    const map = diffSources(prints('ex', 'A', 'B', 'C', 'D'), prints('ex', 'C', 'A', 'D', 'B'));
    expect(map).toEqual([0, 2, 4, 1, 3]);
  });

  it('pairs the edited copy and appends the new one when a question is duplicated', () => {
    // "duplizieren" on B: the original keeps its identity, the copy is new.
    const map = diffSources(prints('ex', 'A', 'B', 'C'), prints('ex', 'A', 'B', 'B', 'C'));
    expect(map).toEqual([0, 1, 2, 4]);
  });

  it('handles a simultaneous delete and edit', () => {
    const map = diffSources(prints('ex', 'A', 'B', 'C', 'D'), prints('ex', 'A', 'C', 'D*'));
    expect(map).toEqual([0, 1, null, 2, 3]);
  });

  it('returns all-null when the new source is empty', () => {
    expect(diffSources(prints('ex', 'A'), [])).toEqual([null, null]);
  });
});

describe('diffSingleElement', () => {
  it('reports an unchanged list as same', () => {
    expect(diffSingleElement(['a', 'b'], ['a', 'b'])).toEqual({ type: 'same' });
  });

  it('reports a same-length text edit as complex', () => {
    expect(diffSingleElement(['a', 'b'], ['a', 'B'])).toEqual({ type: 'complex' });
  });

  it('finds a removal index', () => {
    expect(diffSingleElement(['a', 'b', 'c'], ['a', 'c'])).toEqual({ type: 'removed', index: 1 });
  });

  it('finds an insertion index', () => {
    expect(diffSingleElement(['a', 'c'], ['a', 'b', 'c'])).toEqual({ type: 'added', index: 1 });
  });
});

describe('reconcileOrder — first deal', () => {
  it('keeps source order when randomize is off', () => {
    const questions = src('A', 'B', 'C');
    const order = reconcileOrder(null, questions, { seed: SEED });
    expect(played(order, questions)).toEqual(['Beispiel', 'A', 'B', 'C']);
    expect(order.revision).toBe(0);
  });

  it('keeps the example first and is deterministic for a given seed', () => {
    const questions = src('A', 'B', 'C', 'D', 'E');
    const a = reconcileOrder(null, questions, { seed: SEED, randomize: true });
    const b = reconcileOrder(null, questions, { seed: SEED, randomize: true });
    expect(played(a, questions)[0]).toBe('Beispiel');
    expect(played(a, questions)).toEqual(played(b, questions));
    expect(played(a, questions).slice(1).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('skips disabled questions', () => {
    const questions = [q('Beispiel'), q('A'), q('B', true), q('C')];
    const order = reconcileOrder(null, questions, { seed: SEED });
    expect(played(order, questions)).toEqual(['Beispiel', 'A', 'C']);
  });

  it('applies questionLimit to the deck but keeps the reserve in slots', () => {
    const questions = src('A', 'B', 'C', 'D', 'E');
    const order = reconcileOrder(null, questions, { seed: SEED, limit: 2 });
    expect(played(order, questions)).toEqual(['Beispiel', 'A', 'B']);
    expect(order.slots).toHaveLength(5);
  });

  it('exposes the reserved example slot key', () => {
    const questions = src('A', 'B');
    const order = reconcileOrder(null, questions, { seed: SEED });
    expect(playSlotKeys(order, questions.length)[0]).toBe(EXAMPLE_SLOT_ID);
  });

  it('yields empty projections for an empty source', () => {
    const order = reconcileOrder(null, [] as Q[], { seed: SEED });
    expect(playQuestions(order, [])).toEqual([]);
    expect(playSlotKeys(order, 0)).toEqual([]);
  });
});

describe('reconcileOrder — idempotence', () => {
  it('returns the identical object when nothing changed (StrictMode safety)', () => {
    const questions = src('A', 'B', 'C');
    const first = reconcileOrder(null, questions, { seed: SEED, randomize: true });
    const second = reconcileOrder(first, questions, { seed: SEED, randomize: true });
    const third = reconcileOrder(second, [...questions], { seed: SEED, randomize: true });
    expect(second).toBe(first);
    expect(third).toBe(first); // a fresh array with identical content is still a no-op
  });

  it('keeps the revision when only a question is edited', () => {
    const before = src('A', 'B', 'C');
    const first = reconcileOrder(null, before, { seed: SEED, randomize: true });
    const after = [q('Beispiel'), q('A'), q('B korrigiert'), q('C')];
    const next = reconcileOrder(first, after, { seed: SEED, randomize: true });

    expect(next).not.toBe(first);
    expect(next.revision).toBe(first.revision);
    expect(played(next, after)).toEqual(played(first, before).map(n => (n === 'B' ? 'B korrigiert' : n)));
  });
});

describe('reconcileOrder — randomized game, live edits', () => {
  const questions = src('A', 'B', 'C', 'D', 'E');
  const deal = () => reconcileOrder(null, questions, { seed: SEED, randomize: true });

  it('appends a new question at the end and leaves the dealt order untouched', () => {
    const first = deal();
    const after = [...questions, q('NEU')];
    const next = reconcileOrder(first, after, { seed: SEED, randomize: true });

    expect(played(next, after)).toEqual([...played(first, questions), 'NEU']);
    expect(next.remap).toEqual([0, 1, 2, 3, 4, 5]); // nothing moved
  });

  it('appends a question inserted in the middle of the file at the END of the deck', () => {
    const first = deal();
    const after = [q('Beispiel'), q('A'), q('NEU'), q('B'), q('C'), q('D'), q('E')];
    const next = reconcileOrder(first, after, { seed: SEED, randomize: true });

    expect(played(next, after)).toEqual([...played(first, questions), 'NEU']);
  });

  it('removing an already-asked question pulls the current one back by one', () => {
    const first = deal();
    const dealt = played(first, questions); // [Beispiel, ...5 shuffled]
    const asked = dealt[2]!;                // play index 2 — behind a host sitting on index 4
    const after = questions.filter(x => x.question !== asked);
    const next = reconcileOrder(first, after, { seed: SEED, randomize: true });

    expect(next.revision).toBe(first.revision + 1);
    expect(next.remap[4]).toBe(3);
    // The question the host is looking at is unchanged, just one position earlier.
    expect(played(next, after)[3]).toBe(dealt[4]);
    expect(played(next, after)).toEqual(dealt.filter(n => n !== asked));
  });

  it('removing a not-yet-asked question leaves the current position alone', () => {
    const first = deal();
    const dealt = played(first, questions);
    const pending = dealt[5]!; // last in the deck, ahead of a host on index 2
    const after = questions.filter(x => x.question !== pending);
    const next = reconcileOrder(first, after, { seed: SEED, randomize: true });

    expect(next.remap[2]).toBe(2);
    expect(played(next, after)[2]).toBe(dealt[2]);
  });

  it('removing the on-screen question slides the next one into its place', () => {
    const first = deal();
    const dealt = played(first, questions);
    const onScreen = dealt[3]!;
    const after = questions.filter(x => x.question !== onScreen);
    const next = reconcileOrder(first, after, { seed: SEED, randomize: true });

    expect(next.remap[3]).toBe(3);
    expect(played(next, after)[3]).toBe(dealt[4]);
  });

  it('collapses onto the end of the deck when the last question is removed while on it', () => {
    const first = deal();
    const dealt = played(first, questions);
    const after = questions.filter(x => x.question !== dealt[5]);
    const next = reconcileOrder(first, after, { seed: SEED, randomize: true });

    expect(next.remap[5]).toBe(4); // clamped to the new last play index
  });

  it('is a no-op when the admin reshuffles the file ("Fragen mischen")', () => {
    const first = deal();
    const reshuffled = [q('Beispiel'), q('D'), q('B'), q('E'), q('A'), q('C')];
    const next = reconcileOrder(first, reshuffled, { seed: SEED, randomize: true });

    expect(played(next, reshuffled)).toEqual(played(first, questions));
    expect(next.revision).toBe(first.revision);
    expect(next.remap).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('disabling a question removes it; re-enabling appends it at the end', () => {
    const first = deal();
    const dealt = played(first, questions);
    const disabledOne = dealt[1]!;

    const off = questions.map(x => (x.question === disabledOne ? q(disabledOne, true) : x));
    const afterOff = reconcileOrder(first, off, { seed: SEED, randomize: true });
    expect(played(afterOff, off)).toEqual(dealt.filter(n => n !== disabledOne));

    const on = questions.map(x => (x.question === disabledOne ? q(disabledOne) : x));
    const afterOn = reconcileOrder(afterOff, on, { seed: SEED, randomize: true });
    expect(played(afterOn, on)).toEqual([...dealt.filter(n => n !== disabledOne), disabledOne]);
  });

  it('never plays one question from two slots', () => {
    const first = deal();
    const after = [q('Beispiel'), q('A'), q('A'), q('B')];
    const next = reconcileOrder(first, after, { seed: SEED, randomize: true });
    expect(next.deck.map(s => s.src)).toEqual([...new Set(next.deck.map(s => s.src))]);
  });
});

describe('reconcileOrder — questionLimit refill', () => {
  const questions = src('A', 'B', 'C', 'D', 'E');

  it('pulls an undealt question in when a dealt one is removed', () => {
    const first = reconcileOrder(null, questions, { seed: SEED, randomize: true, limit: 3 });
    const dealt = played(first, questions);
    expect(dealt).toHaveLength(4); // example + 3

    const after = questions.filter(x => x.question !== dealt[1]);
    const next = reconcileOrder(first, after, { seed: SEED, randomize: true, limit: 3 });
    const nextDealt = played(next, after);

    expect(nextDealt).toHaveLength(4);
    expect(nextDealt.slice(1, 3)).toEqual(dealt.slice(2, 4)); // survivors kept their order
    expect(nextDealt[3]).not.toBe(dealt[1]);                  // a reserve question slid in
  });

  it('keeps an appended question behind the undealt reserve', () => {
    const first = reconcileOrder(null, questions, { seed: SEED, randomize: true, limit: 3 });
    const after = [...questions, q('NEU')];
    const next = reconcileOrder(first, after, { seed: SEED, randomize: true, limit: 3 });
    expect(played(next, after)).not.toContain('NEU');
    expect(next.slots.at(-1)!.src).toBe(after.length - 1);
  });

  it('reveals the reserve when the limit is raised live', () => {
    const first = reconcileOrder(null, questions, { seed: SEED, randomize: true, limit: 2 });
    const next = reconcileOrder(first, questions, { seed: SEED, randomize: true, limit: 4 });
    expect(played(next, questions)).toHaveLength(5);
    expect(played(next, questions).slice(0, 3)).toEqual(played(first, questions));
  });
});

describe('reconcileOrder — ordered (non-randomized) game', () => {
  const questions = src('A', 'B', 'C', 'D');

  it('applies an admin reorder live and compensates the index', () => {
    const first = reconcileOrder(null, questions, { seed: SEED });
    const reordered = [q('Beispiel'), q('C'), q('A'), q('D'), q('B')];
    const next = reconcileOrder(first, reordered, { seed: SEED });

    expect(played(next, reordered)).toEqual(['Beispiel', 'C', 'A', 'D', 'B']);
    // A host sitting on 'B' (play index 2) follows it to its new home.
    expect(next.remap[2]).toBe(4);
  });

  it('inserts a new question at its source position', () => {
    const first = reconcileOrder(null, questions, { seed: SEED });
    const after = [q('Beispiel'), q('A'), q('NEU'), q('B'), q('C'), q('D')];
    const next = reconcileOrder(first, after, { seed: SEED });

    expect(played(next, after)).toEqual(['Beispiel', 'A', 'NEU', 'B', 'C', 'D']);
    expect(next.remap[2]).toBe(3); // the host on 'B' stays on 'B'
  });

  it('removing an already-asked question pulls the current one back', () => {
    const first = reconcileOrder(null, questions, { seed: SEED });
    const after = [q('Beispiel'), q('A'), q('C'), q('D')];
    const next = reconcileOrder(first, after, { seed: SEED });

    expect(next.remap).toEqual([0, 1, 2, 2, 3]);
    expect(played(next, after)[2]).toBe('C');
  });
});

describe('reconcileOrder — degenerate cases', () => {
  it('clamps every position to 0 when all questions are deleted', () => {
    const questions = src('A', 'B');
    const first = reconcileOrder(null, questions, { seed: SEED });
    const next = reconcileOrder(first, [] as Q[], { seed: SEED });
    expect(next.remap).toEqual([0, 0, 0]);
    expect(playQuestions(next, [])).toEqual([]);
  });

  it('drops a question that became the example rather than playing it twice', () => {
    const questions = src('A', 'B', 'C');
    const first = reconcileOrder(null, questions, { seed: SEED });
    const after = [q('A'), q('B'), q('C')]; // the Beispiel was deleted
    const next = reconcileOrder(first, after, { seed: SEED });

    expect(played(next, after)).toEqual(['A', 'B', 'C']);
  });
});
