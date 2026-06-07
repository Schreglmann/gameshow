# Spec: Wer kennt mehr?

## Goal
A **final** game where both teams compete to name *more* of a given thing than the other team (e.g. "Nennt so viele europäische Hauptstädte wie möglich"). The host counts how many valid items each team named; the team that named more wins the round and is awarded **points equal to that count**. Because the count can be large (15+), it rewards big swings in the global score.

## Acceptance criteria
- [ ] Starts on the **question** phase: question text (+ optional `info` subtitle, optional `questionImage`, optional `timer`) is shown; teams call out their answers live
- [ ] A host advance (nav-forward) reveals the **answer** phase: the examples are shown — a single string (`answer`) in the standard `.quiz-answer` box, or an **auto-fitting grid** (`answerList`) that always uses the full width of the answer box. A handful of items stretch to fill the row; a long list wraps into as many columns as fit and flows downward. Columns collapse to a single full-width column on narrow screens; nothing ever spills outside the box
- [ ] The answer phase shows a scoring host panel: two **toggle** team buttons (Team 1 / Team 2) + a number input ("Anzahl") + a "Punkte vergeben" button
- [ ] Selecting one team = that team wins → `onAwardPoints(team, count)`. Selecting **both** teams = tie → each team gets `floor(count / 2)`
- [ ] "Punkte vergeben" is disabled until at least one team is selected; submitting awards points and advances to the next question (or completes the game)
- [ ] On the answer phase the page anchors to the **bottom** of the card (`useQuizAutoScroll(..., 'bottom')`) so the scoring panel stays in view even when the examples grid makes the card far taller than the viewport; height changes (team toggle, tie hint) keep the bottom in view instead of snapping back to the top
- [ ] Optional per-question `timer` counts down exactly like `simple-quiz` (shared `Timer`, fixed bottom-left, GM Stop/Pause aware)
- [ ] After the last question, the next advance calls `onGameComplete()`
- [ ] Uses `BaseGameWrapper` with `requiresPoints` + `skipPointsScreen` + `hideCorrectTracker` (points awarded inline, no `AwardPoints` screen)
- [ ] Question index 0 is a non-scoring **"Beispiel Frage"** practice round (its scoring panel advances without awarding points); real questions are labelled `Frage N von M` (M = `questions.length - 1`)
- [ ] `randomizeQuestions` / `questionLimit` honoured via `useShuffledQuestions`; `disabled` questions filtered
- [ ] Gamemaster controls wired: toggle team buttons + number input + submit mirror the on-screen panel. A selected team toggle is clearly marked in the GM by a near-white `outline` ring (`.gm-btn--active`) — using `outline` rather than box-shadow/border so it can't be defeated by the higher-specificity `.gm-btn:hover` reset or by sticky `:hover` on touch (both teams selected = two rings at once, shown instantly). The examples are published via the structured `answerList` field (`{rank, text, revealed: true}[]`) so the GM renders them once as the ranking-style pill grid (`.gamemaster-answer-list`) — not duplicated as a plain `answer` blob plus an `extraInfo` list
- [ ] **Selectable in the admin**: the type appears in the "Neues Spiel erstellen" modal (`GamesTab` `GAME_TYPES`) and the `GameEditor` type `<select>`. These arrays are plain `GameType[]` literals — **not** type-checked for completeness — so a new type compiles fine yet is invisible in the admin until added to both. (A `GAME_TYPE_INFO` label + `GAME_TYPE_TEMPLATES` entry are `Record<GameType, …>` and therefore enforced by `tsc`.)

## State / data changes
- No `AppState` changes
- Config type: `WerKenntMehrConfig` (`type: 'wer-kennt-mehr'`) in [`src/types/config.ts`](../../src/types/config.ts)
- Question type: `WerKenntMehrQuestion`:
  - `question: string` — the prompt
  - `info?: string` — optional subtitle shown above the question
  - `questionImage?: string` — optional question image (raw logical path; encoded at the DOM boundary). **No answer image.**
  - `answer?: string` — single example answer (used when no list)
  - `answerList?: string[]` — list of example answers, rendered as the compact grid. At least one of `answer` / non-empty `answerList` required
  - `timer?: number` — optional time limit in seconds
  - `disabled?: boolean`
- Points awarded inline via `onAwardPoints(team, n)` (the standard `AWARD_POINTS` action; balance clamped at 0)

## UI behaviour
- Component: [`src/components/games/WerKenntMehr.tsx`](../../src/components/games/WerKenntMehr.tsx)
- Phase machine: `question → answer`. Reuses [`QuizQuestionView`](../../src/components/games/QuizQuestionView.tsx) for the question render (info, emoji scaling, `questionImage` via `RetryImage` + lightbox, `Timer` portal) with `showAnswer={false}`; the examples are rendered by this component on reveal
- Single-string `answer` reuses the `.quiz-answer` box; `answerList` renders into a new `.wkm-examples` CSS grid: `grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr))`. `auto-fit` + `1fr` makes the present items stretch to fill the full box width whatever the count (few items spread across the row as wide pills; long lists wrap into a full multi-column block); `min(100%, 200px)` collapses to a single full-width column on narrow screens. Each item is a **chip**: centered text in a rounded (`12px`), success-tinted card (`background rgba(--success-rgb, 0.12)`, `1px` success border). The global `li` `padding`/`border-bottom` (base.css) is reset so no separator dangles. Font is `clamp(1.05rem, 1.9vw, 1.6rem)` for projector readability. Long answers (e.g. a German compound like `Mandragoren-Wiederbelebungstrank (Mandrake Restorative Draught)`) wrap **inside** the chip via `overflow-wrap: anywhere` + `hyphens: auto` — `anywhere` (not `break-word`) is required because only it shrinks the chip's intrinsic min-content width, so the text never spills over neighbouring chips
- Scoring panel reuses the `.bet-quiz-host-panel` / `.bet-quiz-host-row` styling; team buttons are independent toggles (both-on = tie)
- Back navigation: answer → question; question → previous question (shown revealed), mirroring bet-quiz minus audio
- Backend form: [`src/components/backend/questions/WerKenntMehrForm.tsx`](../../src/components/backend/questions/WerKenntMehrForm.tsx). Per-question fields: `question`, optional `info`, optional `questionImage` (`AssetField`), an examples editor (single `answer` field + an `answerList` free-text area, one entry per line), and `timer`. The `answerList` editor edits a raw multi-line **draft** and only normalizes (split on newline → trim → drop empties) **on blur**, so the user can type spaces and press Enter to add rows (normalizing per keystroke would strip the new line instantly). Question-level drag-reorder via `useDragReorder`; cross-instance move via `MoveQuestionButton`; ghost-row pattern

## Out of scope
- Per-question or per-answer audio
- Answer image
- Automatic counting / per-team device input of individual items (host enters the final count)
- Validation against any real-world ground truth — authors define the example list in JSON
