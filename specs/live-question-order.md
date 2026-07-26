# Spec: Live question order (editing the playing game's questions)

## Goal

The host edits the questions of the game that is **currently being played** — in the
admin CMS, mid-show, with the projector live. Adding, removing or disabling a question
must not disturb what the audience sees, and must not lose track of which questions have
already been asked.

Builds directly on [live-config-reload.md](live-config-reload.md), which delivers the edit
to the running frontend. This spec covers what the *game* does with it.

## Background

Question order for a randomized game used to be derived on every render from
`randomizeQuestions(questions, true, limit, seed)` ([src/utils/questions.ts](../src/utils/questions.ts)):
a seeded Fisher–Yates whose permutation depends only on `(seed, list length)`. A same-length
edit was therefore stable — but adding or removing a question changed the length and
**re-dealt the whole deck**, so the host could no longer tell which questions had been asked.
`live-config-reload.md` documented that as an accepted limitation; in a live show it is not.

Three sibling bugs had the same root cause — an unseeded shuffle inside a `useMemo` keyed on
data that gets a fresh object identity on every live re-fetch:

| Where | Effect of any live edit |
|---|---|
| Quizjagd's easy/medium/hard pools | All three decks re-dealt while the consumed counter kept running → **already-asked questions came back around** |
| Q1's statement shuffle | The statements of the on-screen question re-scrambled — and since the shuffle also places the wrong statement, the answer moved |
| Ranking's `items` candidate pool, ImageGuess's random `obfuscation` | Re-rolled mid-question |

Questions carry **no id** ([src/types/config.ts](../src/types/config.ts)) — they are pure array
positions — and adding one is not viable: only the admin `PUT` path could mint ids, while the
watcher also covers direct file edits, `git`, and `npm run fixtures`. A file that gained ids
mid-show would read as "everything deleted, everything added". So identity is established by a
content diff instead.

## Acceptance criteria

- [ ] **Add** a question to a *randomized* playing game → it is appended at the **end** of the
      play order. Already-played and still-pending questions keep their order and their numbers.
- [ ] **Add** a question to an *ordered* (non-randomized) playing game → it lands at its
      **source position** (the admin's explicit intent), and the on-screen question does not move.
- [ ] **Remove** a question that was **already asked** → it is dropped and the current question
      number drops by one; the **same question stays on screen**.
- [ ] **Remove** a question **not yet asked** → it is dropped; the current position is untouched.
- [ ] **Remove** the question **on screen** → the next pending question slides into its place and
      per-question state resets, as if the host had pressed *Weiter*.
- [ ] Toggling `disabled` behaves exactly like remove / (on re-enable) add.
- [ ] Pressing admin's **"🔀 Fragen mischen"** during a randomized game is a **no-op** on the
      running deck.
- [ ] Fixing a typo on the current question updates it in place (the `live-config-reload.md`
      guarantee, unchanged) — including when the list length also changed in the same save.
- [ ] With `questionLimit` set the deck stays at exactly that size: removing a question pulls the
      next **undealt** one in at the end of the deck. An appended question queues behind that
      reserve. Raising the limit live reveals more of the reserve.
- [ ] Except for "remove the question on screen", **nothing on the projector changes** at the
      moment of the edit: no timer re-arm, no audio or video restart, no de-blur/zoom restart,
      no scroll jump, no fullscreen close, no gamemaster reveal-state desync.
- [ ] The gamemaster's per-question correct-answer tally follows the questions it was recorded
      against; a deleted question's counts move to the reserved `none` bucket, never onto a
      neighbour.
- [ ] Quizjagd never repeats an already-asked question after a live edit, and its three pools
      keep the order they were dealt in.
- [ ] Q1's statements, Ranking's candidate pool and ImageGuess's obfuscation effect stay put
      across a live edit (still fresh per playthrough).
- [ ] Back-navigating into a game replays the deck it was played with, and never opens on a
      question that was appended after the game was played.

## State / data changes

No `AppState` shape change beyond one action, no localStorage change, **no HTTP route or
WebSocket channel change** — `GameDataResponse`, `ContentChangedPayload` and the
`gamemaster-question-tally` payload shape are all untouched.

### `src/utils/questionOrder.ts` (new, pure)

- `stableFingerprint(q)` — recursively key-sorted JSON. Plain `JSON.stringify` is key-order
  sensitive, and the admin's question forms rebuild objects via `{ ...next[i], ...patch }` plus
  `delete`. (`JSON.stringify(o, keysArray)` is *not* a shortcut for this — the replacer array
  filters keys at every nesting level.) `disabled` is part of the fingerprint.
- `diffSingleElement(prev, next)` — classifies a single structural edit; moved here from
  `Ranking.tsx`, which still imports it for its progressive-reveal reconciliation.
- `diffSources(oldPrints, newPrints) → (number | null)[]` — maps each old source index to its
  new one, `null` if gone. Source index 0 (the "Beispiel") is hard-pinned to 0 and excluded from
  the diff, because every game hardcodes `qIdx === 0` as the example. Layers:
  1. unchanged → identity;
  2. a clean single insert/delete → exact index, via `diffSingleElement`;
  3. otherwise → **anchored diff**: first map every fingerprint that is unique on *both* sides to
     its twin regardless of where it moved (this is what makes a pure reorder a no-op), then pair
     the leftovers positionally inside the brackets formed by the monotonic subset of those
     matches (this is what reads as "edited in place" rather than "deleted and re-added").
     Anchoring only on *unique* fingerprints is what makes the admin's "duplizieren" button safe.
- `reconcileOrder(prev, questions, { randomize, limit, seed }) → PlayOrder` — folds a new source
  array into the existing order. Returns the **same object** when nothing changed, which is what
  makes calling it during render idempotent under StrictMode's double invocation.

```ts
interface QuestionSlot { slotId: number; src: number }

interface PlayOrder {
  seed: number;
  srcPrints: string[];   // fingerprints this order was reconciled against
  slots: QuestionSlot[]; // FULL play order (excl. source index 0) — includes the
                         // reserve outside questionLimit, which is what refills the deck
  deck: QuestionSlot[];  // slots capped at questionLimit — what the game plays
  revision: number;      // bumps only when the deck MOVED, i.e. only when an index needs remapping
  remap: number[];            // prevPlayIdx -> newPlayIdx for the CURSOR
  moved: (number | null)[];   // prevPlayIdx -> newPlayIdx for the QUESTION (null = deleted)
  nextSlotId: number;
}
```

`slotId` is minted when a question first enters the order and never reused — it is the question's
identity across live edits, independent of its shifting index. Slot `0` (`EXAMPLE_SLOT_ID`) is
reserved for the example question.

`remap` and `moved` differ in exactly one case: a position whose question was deleted. The
*cursor* resolves to where that question's successor landed (the next question slides in); the
*question* resolves to `null`, so per-question data is never re-attributed to a neighbour.

The first deal uses the same PRNG, the same Fisher–Yates loop and the same list length as
`randomizeQuestions`, so it is byte-identical to the pre-slot behaviour.

### `src/utils/gamePlaythroughStore.ts`

Widened from `Map<gameId, seed>` to `Map<gameId, { seed, order, highWater }>`. Storing the
**order** — not just the seed — is what makes the guarantee survive a *length* change. In-memory
and session-scoped as before: a page reload clears it, matching the rule that a reload restarts
the show from home. `tests/setup.ts` clears it before every test, modelling a fresh page load.

`highWater` is the furthest play index the show reached; back-review resumes at
`min(lastIndex, highWater)` so it never opens on a question appended after the game was played.

### Hooks

- **`useQuestionOrder(questions, randomize?, limit?, gameId?)`** → `{ questions, order }`.
  Reconciles during render and returns the play-ordered list plus a `QuestionOrderHandle`:
  `revision`, `slotKeys`, `remap`, `moved`, `slotSeed`, `resumeIndex`, `note`.
  Replaces the former `useShuffledQuestions`, which is deleted.
- **`useLiveQuestionIndex(order, resumeAtEnd?)`** → `[qIdx, setQIdx, qKey]`. Drop-in replacement
  for the `useState` each game held its `qIdx` in. It adjusts **during render**, not in an effect
  — an effect commits after paint, so the shift frame would paint the new question list at the
  old index: one frame of the wrong question in front of an audience.

`order.slotSeed(playIdx)` gives a question a stable seed for whatever it shuffles or picks
internally. Fresh per playthrough, but immune to both a live edit and an index shift. Used by
Q1 (statement order), Ranking (candidate pool), ImageGuess (obfuscation effect) and RandomFrame
(frame seed + re-roll counter).

### `REMAP_QUESTION_TALLY`

New `GameContext` action, `{ gameIndex, moved }`. The correct-answer tally is keyed by question
index ([gamemaster-question-scores.md](gamemaster-question-scores.md)), so a shift would silently
misattribute every bucket after the edit. Dispatched by `BaseGameWrapper` on an `order.revision`
bump. A deleted question's counts merge into the reserved `NO_QUESTION_KEY` bucket — a tap made
in a live show is never dropped, but it is never re-attributed either. Historical `ScoreLogEntry`
records are left alone.

## UI behaviour

### The `qIdx` / `qKey` split

Every game now holds two values for the current question: `qIdx`, its **position**, and `qKey`,
its **identity**. The rule:

- **`qIdx`** wherever the position is the point — the `setGamemasterData` payload above all: the
  gamemaster's question number *should* drop when an earlier question is deleted.
- **`qKey`** for every per-question effect whose re-run the audience would notice: audio and video
  load/autoplay, the per-question timer arm, `useQuizAutoScroll`, asset-failure resets, the
  ImageGuess de-blur/zoom RAF, Ranking's reveal baseline, Bandle's and AudioGuess's media-URL
  baselines.

`qIdx` also appears in ~45 dependency arrays where a re-run is harmless or wanted; those are left
alone deliberately — a blanket swap would be a bigger risk than the bug.

Where a callback logged `qIdx` and was itself an audio-effect dependency, the index is read
through a ref so the callback stays referentially stable (SimpleQuiz, Bandle, AudioGuess,
VideoGuess, FourStatements).

### `BaseGameWrapper`

Takes an optional `order` prop and derives a **question token** from
`order.slotKeys[questionNumber]`. Its reset-on-question-change effect keys on that token instead
of on `questionNumber`, so a compensating shift no longer clears the GM deadline timer, closes
fullscreen, wipes the paused-media resume state, or resets `answerRevealed` (which would *not*
re-assert, because the child only pushes it when `showAnswer` changes). Falls back to
`questionNumber` when no `order` is passed.

### Quizjagd

Quizjagd has three decks and no single cursor, so it does not use `useLiveQuestionIndex`. Each
difficulty gets its own `useQuestionOrder` (keyed `${gameId}#easy` etc., so the pools shuffle
independently and persist for the session), and "which questions have been asked" is tracked as a
set of **slot keys** per difficulty rather than a per-pool index. Identities need no remapping at
all: a deleted question simply never comes up again, and an added one queues at the end of its pool.

## Out of scope / known limitations

- A same-length save that deletes one question and adds a different one is read as an edit in
  place: the new question takes the deleted one's slot rather than being appended. Indistinguishable
  from a rewrite without ids, and the safer default (it preserves the typo-fix guarantee).
- Deleting the source index 0 "Beispiel" question mid-show promotes whatever lands at play
  position 0 to "Beispiel", since every game hardcodes that. Cosmetic, and an absurd mid-show action.
- Deleting questions until the deck is empty leaves the card blank until the host navigates —
  every game null-guards, so no crash. Unchanged from before.
- The same `gameId` appearing twice in `gameOrder` shares one playthrough entry, so the second
  playthrough inherits the first's deck and edit history. Already true of the seed before this change.
- Toggling `randomizeQuestions` itself mid-game does not re-deal; the existing order is kept and the
  new mode applies from the next reconcile.
- The order lives in memory only. A full page reload of the show restarts from home anyway.
