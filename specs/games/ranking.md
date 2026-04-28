# Spec: Ranking

## Goal
Host asks a question whose answer is an ordered list (e.g. "Top 5 highest-grossing films of 2023 — in order"). Teams guess the correct order; the host reveals one rank at a time.

## Acceptance criteria
- [ ] Starts with the question visible and **0** answers revealed
- [ ] Each host advance reveals the next answer, appended below the previous ones and prefixed with its rank (`1.`, `2.`, `3.`, …). Order is the JSON order
- [ ] Newly-revealed rows are auto-scrolled into view (same multi-retry pattern as `four-statements`)
- [ ] Holding the Right arrow key for ≥500 ms reveals all remaining answers at once (same interaction as Bandle's jump-to-answer); a short tap still advances by one
- [ ] Host can navigate backwards (ArrowLeft) to un-reveal the most recent answer, or — with nothing revealed — return to the previous question (shown fully revealed)
- [ ] After the last answer of the last question, one more advance calls `onGameComplete()`
- [ ] Uses `BaseGameWrapper`; points awarded via `AwardPoints` (host picks winner) — point value = `currentIndex + 1`
- [ ] `randomizeQuestions` is honoured (first question preserved as example), `disabled` questions are filtered
- [ ] Gamemaster sync publishes `answer: "1. A · 2. B · …"` and `extraInfo: "Platz N/M"`
- [ ] No separate final-answer screen — the ordered list **is** the answer

## State / data changes
- No `AppState` changes
- Config type: `RankingConfig` (`type: 'ranking'`) in [`src/types/config.ts`](../../src/types/config.ts)
- Question type: `RankingQuestion`:
  - `question: string` — the prompt shown at the top
  - `answers: string[]` — ordered list; index 0 = rank 1. At least one non-empty entry required
  - `topic?: string` — optional subtitle shown under the question label
  - `disabled?: boolean`

## UI behaviour
- Component: [`src/components/games/Ranking.tsx`](../../src/components/games/Ranking.tsx)
- Question label: `Beispiel` for index 0, otherwise `Frage N von M`
- Question text rendered in `.quiz-question`; optional `topic` shown below it
- Answers rendered via the existing `.statements-container` / `.statement` CSS (shared with four-statements and q1). Each row contains `<span className="statement-rank">{N}.</span> text`
- Autoscroll-to-bottom runs on every `revealedCount` change, reusing the `[0, 80, 200, 500]` retry delays from `FourStatements`
- Long-press detection: ArrowRight `keydown` starts a 500 ms timer that sets `revealedCount = answers.length`; `keyup` inside that window falls through to the normal "advance one" handler (same useRef / capture-phase pattern as Bandle)
- Backend form: [`src/components/backend/questions/RankingForm.tsx`](../../src/components/backend/questions/RankingForm.tsx). Per-question fields: `question`, optional `topic`, dynamic `answers[]` list with add/remove + drag-reorder within the list. Question-level drag-reorder via `useDragReorder` (matches Bandle/FourStatements forms)

## Out of scope
- Per-answer images or assets
- Per-team device guessing / inline scoring
- Timed auto-reveal
- A separate final-answer card (the ordered list is itself the reveal)
- Validation that the rank matches any "real-world" ground truth — authors define the order in JSON
