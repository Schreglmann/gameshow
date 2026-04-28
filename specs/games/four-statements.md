# Spec: Four Statements (clue-based)

## Goal
Host reveals up to four clue-statements one at a time about a target concept; teams guess the answer, then host reveals it (text and/or image).

## Naming note
A previous game type named `four-statements` (find the false statement out of 3-true-1-false) was renamed to `q1` when this new clue-based mode was introduced. See [specs/games/q1.md](q1.md).

## Acceptance criteria
- [ ] Starts with **0** statements visible — only the topic/prompt is shown
- [ ] Each host advance reveals the next statement (1 → 2 → 3 → ...); previously revealed statements stay visible in order
- [ ] Each question has up to 4 statement slots. Empty slots are skipped (not rendered, not counted in the reveal sequence); at least one non-empty is required. After the last non-empty statement is revealed, one more advance shows the answer
- [ ] Answer can be: text only, image only, or both. At least one must be present — validator enforces
- [ ] Host can navigate backwards (ArrowLeft) to un-reveal the answer, un-reveal a statement, or return to the previous question
- [ ] Works across multiple questions; after the last answer, advance calls `onGameComplete()`
- [ ] Uses `BaseGameWrapper`; points awarded via `AwardPoints` (host picks winner) — point value = `currentIndex + 1`
- [ ] Gamemaster sync publishes `answer`, `answerImage`, and `extraInfo: "Hinweis N/M"`

## State / data changes
- No `AppState` changes
- Config type: `FourStatementsConfig` (`type: 'four-statements'`) in [`src/types/config.ts`](../../src/types/config.ts)
- Question type: `FourStatementsQuestion`:
  - `topic: string` — prompt shown at top
  - `statements: string[]` — up to 4 entries; empty strings are allowed and represent empty slots (skipped at render). At least one non-empty entry is required
  - `answer?: string` — text label
  - `answerImage?: string` — DAM-relative image path
  - `disabled?: boolean`
  - Invariant: at least one of `answer` / `answerImage` must be set

## UI behaviour
- Component: [`src/components/games/FourStatements.tsx`](../../src/components/games/FourStatements.tsx)
- Topic displayed at top with `.quiz-question` styling
- Statements rendered in order using existing `.statements-container` / `.statement` CSS classes (shared with Q1)
- Each statement gets a small numeric prefix (1., 2., ...)
- No shuffle — statement order is the JSON order
- Answer block: if `answer` → text card (`rgba(74,222,128,0.2)` background, same "Lösung" style as Q1's "Gesuchter Begriff"); if `answerImage` → `<img className="quiz-image">` below the text
- Admin form: [`src/components/backend/questions/FourStatementsForm.tsx`](../../src/components/backend/questions/FourStatementsForm.tsx). Always shows all 4 statement inputs as a 2×2 grid (via the existing 2-col `.question-fields` grid) — no add/remove buttons. Empty inputs persist as empty strings and simply aren't rendered in the game. Image picked via shared `AssetField` (DAM)

## Out of scope
- Per-team device guessing
- More than 4 statements
- Timed auto-reveal
- True/false semantics on individual statements (that's `q1`)
