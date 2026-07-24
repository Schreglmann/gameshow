# Spec: Ranking

## Goal
Host asks a question whose answer is an ordered list (e.g. "Top 5 highest-grossing films of 2023 — in order"). Teams guess the correct order; the host reveals one rank at a time.

## Acceptance criteria
- [ ] Starts with the question visible and **0** answers revealed
- [ ] Each host advance reveals the next answer, appended below the previous ones and prefixed with its rank (`1.`, `2.`, `3.`, …). Order is the JSON order
- [ ] The **final** answer's row is visually flagged with a thicker accent border (`.ranking-row--last`) once revealed, so the host knows the reveal is complete and can stop advancing before slipping into the next question
- [ ] Newly-revealed rows are auto-scrolled into view (same multi-retry pattern as `four-statements`)
- [ ] Holding the forward key (ArrowRight **or** Space) reveals all remaining answers at once (same interaction as Bandle's jump-to-answer); a short tap still advances by one. The hold is detected via OS key-repeat or a ≥500 ms timer, whichever comes first (robust against presenter clickers that send an early keyup). Works both on the show's local keyboard and via the gamemaster remote (a held forward key there arrives as `nav-forward-long`)
- [ ] Host can navigate backwards (ArrowLeft) to un-reveal the most recent answer, or — with nothing revealed — return to the previous question (shown fully revealed)
- [ ] After the last answer of the last question, one more advance calls `onGameComplete()`
- [ ] Uses `BaseGameWrapper`; points awarded via `AwardPoints` (host picks winner) — point value = `currentIndex + 1`
- [ ] `randomizeQuestions` is honoured (first question preserved as example), `disabled` questions are filtered
- [ ] Gamemaster sync publishes `answer: "1. A · 2. B · …"` and `extraInfo: "Platz N/M"`
- [ ] No separate final-answer screen — the ordered list **is** the answer
- [ ] When a question has a non-empty `items[]`, the guessing phase (0 answers revealed) presents **all** of those items in a **shuffled** order (a labelled "pool") so teams sort the given items instead of recalling them. `items` are the bare candidates — **distinct from `answers`, which reveal the full solution** (item + its value), so the durations are never spoiled. The shuffle is memoized per question mount → a fresh order each playthrough. As soon as the host reveals the first rank, the pool is replaced by the ordered rank-by-rank reveal. A question with no `items` keeps the classic open-recall behaviour (nothing shown until reveal) — the pool is driven purely by `items` presence, there is no separate toggle
- [ ] Optional `answerAudio` plays once during the reveal — on the first revealed answer when `answerAudioTrigger` is `first` (default), or once all answers are revealed when `all`. Built via `toMediaSrc()` + `safePlay()`; fires once per reveal cycle (resets when nothing is revealed / on question change)
- [ ] **Listen-first cue step** (default `first` trigger with `answerAudio` only): the first forward press starts the audio **without** revealing any rank; the first rank waits for the **next** press. Subsequent presses reveal one rank each. Backwards navigation reverses it: un-reveal down to 0, then one more back un-cues (stops the clip) before returning to the previous question. The long-press "reveal all" and the GM rank-jump skip the cue (they reveal directly, which also starts the audio). The `all` trigger has no cue step (audio only plays once everything is shown); a question without `answerAudio` reveals its first rank on the first press as before
- [ ] Optional trim on `answerAudio`: playback begins at `answerAudioStart` (seconds) and stops at `answerAudioEnd` (seconds); with `answerAudioLoop` the trimmed section repeats instead of stopping. Same behaviour as simple-quiz's answer-audio trim (timeupdate-gated end + loop); listeners are torn down on reveal-reset, question change, and unmount
- [ ] When a question has `answerAudio` and the reveal clip has started playing, the gamemaster gets an `audio-controls` button-group (`audio-playpause` → Pause/Abspielen, `audio-restart` → "Von vorne"), identical to the audio games. `audio-playpause` toggles the shared reveal audio (resuming from the trim start if it already ran to `answerAudioEnd`); `audio-restart` seeks to `answerAudioStart` (or 0) and replays. The controls appear only after the clip begins (so the GM can't start it early) and clear on reveal-reset / question change / game exit
- [ ] When any question has `answerAudio`, background music fades out (~2 s) at the rules screen and fades back in (~3 s) when the game is left (award-points / next game), exactly like simple-quiz; the answer track is faded out on the way out so it never competes with the playlist. If no question has audio, background music is never touched

## State / data changes
- No `AppState` changes
- Config type: `RankingConfig` (`type: 'ranking'`) in [`src/types/config.ts`](../../src/types/config.ts)
- Question type: `RankingQuestion`:
  - `question: string` — the prompt shown at the top. May be empty when `items` provide the prompt (the empty `.quiz-question` is not rendered, so there's no leftover gap); a question needs a non-empty `question` **or** `items`
  - `answers: string[]` — ordered list; index 0 = rank 1. At least one non-empty entry required. May carry the full solution (item + value)
  - `items?: string[]` — optional bare candidates shown to teams during guessing (shuffled). Their presence enables the item pool for the question. Distinct from `answers`; order is irrelevant. If present, must be an array of strings
  - `topic?: string` — optional subtitle shown under the question label
  - `answerAudio?: string` — optional audio clip (raw logical path) played during the reveal
  - `answerAudioStart?: number` — optional trim start in seconds (playback begins here)
  - `answerAudioEnd?: number` — optional trim end in seconds (playback stops / loops here)
  - `answerAudioLoop?: boolean` — loop the trimmed section instead of stopping at the end
  - `answerAudioTrigger?: 'first' | 'all'` — when the clip plays: on the first revealed answer (default) or once all are revealed
  - `disabled?: boolean`

## UI behaviour
- Component: [`src/components/games/Ranking.tsx`](../../src/components/games/Ranking.tsx)
- Question label: `Beispiel` for index 0, otherwise `Frage N von M`
- Question text rendered in `.quiz-question` **only when non-empty** (an empty `question` renders no box, so an items-only question has no leftover top gap); optional `topic` shown below it
- Answers rendered via the existing `.statements-container` / `.statement` CSS (shared with four-statements and q1). Each row contains `<span className="statement-rank">{N}.</span> text`
- When a question has `items` and nothing is revealed yet, the same `.statements-container` renders the shuffled item pool instead: rows use `.ranking-pool-row` with a neutral `•` bullet (`.ranking-pool-bullet`) in place of the rank, under a `.ranking-pool-label` heading. The shuffle is a `useMemo` keyed on the current `items` (stable across re-renders, like Q1's statement shuffle) → a fresh order per playthrough. Items are the bare candidates; the solution-bearing `answers` are never shown in the pool
- Guessing phase (0 revealed): `useQuizAutoScroll(qIdx, 'top', 'instant', revealedCount === 0)` anchors the `.quiz-container` card just below the sticky header and, when the question + item pool overflow the viewport, nudges down so the bottom comes into view — the same behaviour as simple-quiz (reduces the top space on a long question). The hook is disabled once the reveal starts so it never fights the reveal scroll
- Autoscroll-to-bottom runs on every `revealedCount > 0` change, reusing the `[0, 80, 200, 500]` retry delays from `FourStatements`
- Long-press detection uses the shared [`useArrowRightLongPress`](../../src/hooks/useArrowRightLongPress.ts) hook (capture-phase listeners; hold detected via OS key-repeat or a 500 ms timer; forward key is ArrowRight or Space): a held forward key sets `revealedCount = answers.length`, a `keyup` inside the window falls through to the normal "advance one" handler. The hook is disabled once everything is revealed so a press advances to the next question. The gamemaster's `nav-forward-long` command is routed to the same reveal-all action via the component's command handler (mirrors `bandle` and `four-statements`)
- Backend form: [`src/components/backend/questions/RankingForm.tsx`](../../src/components/backend/questions/RankingForm.tsx). Per-question fields: `question`, optional `topic`, dynamic `answers[]` list with add/remove + drag-reorder within the list. The `answers[]` list is **collapsed by default** behind a clickable header (`Antworten in korrekter Reihenfolge (N)` + rotating chevron) showing a compact one-line ` · `-joined preview when collapsed; expand to edit. Optional `answerAudio` is picked via the shared `AssetField` (category `audio`), with a collapsible `AudioTrimTimeline` (the "✂ Trimmen" toggle, shown only when audio is set) editing `answerAudioStart`/`answerAudioEnd`/`answerAudioLoop` — same trim control as simple-quiz; changing the audio file clears the trim. A `be-toggle` (shown only when audio is set) selects the trigger — checked = `all`, unchecked = `first` (default). Each question has a collapsible **"Zu sortierende Elemente (N)"** list editing `items[]` (bare candidates shown to teams; entering any items enables the pool for that question): per-row inputs with a trailing auto-add slot, a remove (×) button, and **newline-paste bulk entry** (pasting multi-line text splits into one item per line). Question-level drag-reorder via `useDragReorder` (matches Bandle/FourStatements forms)

## Out of scope
- Per-answer images or per-answer audio (a single `answerAudio` clip per question only)
- Per-team device guessing / inline scoring
- Timed auto-reveal
- A separate final-answer card (the ordered list is itself the reveal)
- Validation that the rank matches any "real-world" ground truth — authors define the order in JSON
