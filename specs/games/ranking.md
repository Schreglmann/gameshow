# Spec: Ranking

## Goal
Host asks a question whose answer is an ordered list (e.g. "Top 5 highest-grossing films of 2023 — in order"). Teams guess the correct order; the host reveals one rank at a time.

## Acceptance criteria
- [ ] Starts with the question visible and **0** answers revealed
- [ ] Each host advance reveals the next answer, appended below the previous ones and prefixed with its rank (`1.`, `2.`, `3.`, …). Order is the JSON order
- [ ] Newly-revealed rows are auto-scrolled into view (same multi-retry pattern as `four-statements`)
- [ ] Holding the forward key (ArrowRight **or** Space) reveals all remaining answers at once (same interaction as Bandle's jump-to-answer); a short tap still advances by one. The hold is detected via OS key-repeat or a ≥500 ms timer, whichever comes first (robust against presenter clickers that send an early keyup). Works both on the show's local keyboard and via the gamemaster remote (a held forward key there arrives as `nav-forward-long`)
- [ ] Host can navigate backwards (ArrowLeft) to un-reveal the most recent answer, or — with nothing revealed — return to the previous question (shown fully revealed)
- [ ] After the last answer of the last question, one more advance calls `onGameComplete()`
- [ ] Uses `BaseGameWrapper`; points awarded via `AwardPoints` (host picks winner) — point value = `currentIndex + 1`
- [ ] `randomizeQuestions` is honoured (first question preserved as example), `disabled` questions are filtered
- [ ] Gamemaster sync publishes `answer: "1. A · 2. B · …"` and `extraInfo: "Platz N/M"`
- [ ] No separate final-answer screen — the ordered list **is** the answer
- [ ] Optional `answerAudio` plays once during the reveal — on the first revealed answer when `answerAudioTrigger` is `first` (default), or once all answers are revealed when `all`. Built via `toMediaSrc()` + `safePlay()`; fires once per reveal cycle (resets when nothing is revealed / on question change)
- [ ] When any question has `answerAudio`, background music fades out (~2 s) at the rules screen and fades back in (~3 s) when the game is left (award-points / next game), exactly like simple-quiz; the answer track is faded out on the way out so it never competes with the playlist. If no question has audio, background music is never touched

## State / data changes
- No `AppState` changes
- Config type: `RankingConfig` (`type: 'ranking'`) in [`src/types/config.ts`](../../src/types/config.ts)
- Question type: `RankingQuestion`:
  - `question: string` — the prompt shown at the top
  - `answers: string[]` — ordered list; index 0 = rank 1. At least one non-empty entry required
  - `topic?: string` — optional subtitle shown under the question label
  - `answerAudio?: string` — optional audio clip (raw logical path) played during the reveal
  - `answerAudioTrigger?: 'first' | 'all'` — when the clip plays: on the first revealed answer (default) or once all are revealed
  - `disabled?: boolean`

## UI behaviour
- Component: [`src/components/games/Ranking.tsx`](../../src/components/games/Ranking.tsx)
- Question label: `Beispiel` for index 0, otherwise `Frage N von M`
- Question text rendered in `.quiz-question`; optional `topic` shown below it
- Answers rendered via the existing `.statements-container` / `.statement` CSS (shared with four-statements and q1). Each row contains `<span className="statement-rank">{N}.</span> text`
- Autoscroll-to-bottom runs on every `revealedCount` change, reusing the `[0, 80, 200, 500]` retry delays from `FourStatements`
- Long-press detection uses the shared [`useArrowRightLongPress`](../../src/hooks/useArrowRightLongPress.ts) hook (capture-phase listeners; hold detected via OS key-repeat or a 500 ms timer; forward key is ArrowRight or Space): a held forward key sets `revealedCount = answers.length`, a `keyup` inside the window falls through to the normal "advance one" handler. The hook is disabled once everything is revealed so a press advances to the next question. The gamemaster's `nav-forward-long` command is routed to the same reveal-all action via the component's command handler (mirrors `bandle` and `four-statements`)
- Backend form: [`src/components/backend/questions/RankingForm.tsx`](../../src/components/backend/questions/RankingForm.tsx). Per-question fields: `question`, optional `topic`, dynamic `answers[]` list with add/remove + drag-reorder within the list. The `answers[]` list is **collapsed by default** behind a clickable header (`Antworten in korrekter Reihenfolge (N)` + rotating chevron) showing a compact one-line ` · `-joined preview when collapsed; expand to edit. Optional `answerAudio` is picked via the shared `AssetField` (category `audio`), with a `be-toggle` (shown only when audio is set) selecting the trigger — checked = `all`, unchecked = `first` (default). Question-level drag-reorder via `useDragReorder` (matches Bandle/FourStatements forms)

## Out of scope
- Per-answer images or per-answer audio (a single `answerAudio` clip per question only)
- Audio trim (start/end) and loop for `answerAudio`
- Per-team device guessing / inline scoring
- Timed auto-reveal
- A separate final-answer card (the ordered list is itself the reveal)
- Validation that the rank matches any "real-world" ground truth — authors define the order in JSON
