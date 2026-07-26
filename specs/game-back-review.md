# Spec: Back-review a previous game (resume at end + stable order)

## Goal
When the host navigates **back** into a previous game, it opens at that game's **end** (last question, answer revealed) so they can step back through every question — instead of resetting to the title screen — and, when `randomizeQuestions` is on, the questions appear in the **exact order that was played**.

## Background
- Games advance `landing → rules → game → (points) → next game`. Back-navigation reverses this and, within a game, steps question-by-question via each game's `backNavHandler` (which reveals the previous question's answer as it steps). See [app-navigation-flow.md](app-navigation-flow.md) and [base-game-wrapper.md](base-game-wrapper.md).
- Crossing a game boundary re-navigates to `/game?index=N`, which **remounts** the game (`<GameFactory key={gameId}>`). Without the store below, that remount resets to the title screen and, for randomized games, re-shuffles into a **new** order.

## Acceptance criteria
- [x] Navigating **back** into a previous game (from the next game's landing screen) opens it in the `game` phase at the **last** question with the answer revealed — not the title screen
- [x] From that resumed end state, pressing back steps through all of the game's questions in reverse (existing per-game `backNavHandler`), then to `rules` → `landing` → previous game — the normal cascade
- [x] When `randomizeQuestions` is on, a game re-entered via back shows the **same** question order it was played in (the deck is stored for the whole session, per game)
- [x] That holds even if the game's questions were **edited while it was played** — the stored deck is the reconciled one, not a re-derivation from `(seed, length)`. See [live-question-order.md](live-question-order.md)
- [x] A resumed game opens at the last question **actually asked**, never at one appended after the game was played (the store's `highWater` mark)
- [x] Forward/fresh entry is unchanged: a game entered by playing forward (or reached for the first time) opens at its title screen at question 0
- [x] After reviewing back to the title and then going **forward** again, the game plays from question 0 (the resume is a one-shot for the back-arrival, not sticky)
- [x] Games without per-question back-stepping keep opening at the title screen: `quizjagd` (turn-based, no linear last question), `final-quiz` & `guessing-game` (betting / guess-capture flows), `fact-or-fake` (no back handler). Their order is still preserved when randomized

## Scope of "resume at end"
Applies to the games that already support stepping back through their questions:
- **Positional** (`qIdx` + `showAnswer`): `simple-quiz`, `audio-guess`, `video-guess`, `image-guess`, `colorguess`, `random-frame` → resume = `qIdx = last`, `showAnswer = true`
- **Progressive-reveal / phased**: `q1`, `four-statements`, `bandle` (`revealedCount = full`, `showAnswer = true`), `ranking` (`revealedCount = full`, no `showAnswer`), `bet-quiz` & `wer-kennt-mehr` (`phase = 'answer'` on the last question)

Out of scope: `quizjagd`, `final-quiz`, `guessing-game`, `fact-or-fake` (see AC). Reconstructing the live bet/count *result* UI for `bet-quiz`/`wer-kennt-mehr` is out of scope — the resumed answer view shows the question and its correct answer; the per-team bet/count outcome from the live round is not re-displayed.

## State / data changes
- Session-scoped store `src/utils/gamePlaythroughStore.ts`: `Map<gameId, { seed, order, highWater }>` — the shuffle seed, the reconciled play order ([live-question-order.md](live-question-order.md)) and the furthest play index reached. In-memory only (cleared on page reload — matches "no resume after reload"), and cleared before every test in `tests/setup.ts`.
- `useQuestionOrder(questions, shouldRandomize, limit, gameId?)`: when `gameId` is given, both the seed and the reconciled order come from the store (stable across remounts); without it they live for the component's lifetime. The paired `useLiveQuestionIndex(order, resumeAtEnd)` resolves the resume position as `min(lastIndex, highWater)`.
- Resume signal via React Router: `GameScreen.handlePrevGame` navigates with `{ state: { resumeAtEnd: true } }` for the previous-game case. `GameScreen` reads `useLocation().state?.resumeAtEnd` and passes it as a new optional prop.
- New optional prop `resumeAtEnd?: boolean` on `GameComponentProps` and `BaseGameWrapperProps`.
- `BaseGameWrapper`: initial phase is `game` (not `landing`) when `resumeAtEnd`; it exposes an adjusted `resumeAtEnd` to its `children` render-prop that is a **one-shot** — true only until the game phase is first left (so replaying forward after a back-review starts at question 0). No `AppState` change; phase stays local to the wrapper.

## UI behaviour
- Back into a previous game → its last question, answer shown; the gamemaster "Zurück"/"Weiter" controls and the show render exactly as the last question normally does.
- Everything else (forward play, first-game back to global rules / start page) unchanged — see [app-navigation-flow.md](app-navigation-flow.md).

## Out of scope
- Persisting playthrough across a full page reload
- Re-displaying live per-round scoring outcomes (bet results, per-team counts) on a resumed answer screen
- Resume-at-end for `quizjagd` / `final-quiz` / `guessing-game` / `fact-or-fake`
