# Spec: Bet Quiz ("Einsatzquiz")

## Goal
A quiz round where each question has a category revealed up front. Both teams secretly wager a portion of their existing total points; the team with the higher bet answers. Correct → the team gains the bet; wrong → the team loses the bet.

## Acceptance criteria
- [x] Each question has a required `category: string` field (plus the full set of fields from `SimpleQuizQuestion`: question, answer, images, audio, list, timer, colors, replaceImage)
- [x] Before each question, a full-screen category reveal phase is shown with large category text (no question/answer visible yet)
- [x] On the category screen, the gamemaster UI shows: two team buttons (Team 1 / Team 2 with member names), a numeric bet input, and a "Frage anzeigen" submit button
- [x] The submit button is disabled until a team is selected AND a non-empty bet is entered AND bet ≤ that team's current total points (hard cap; includes 0-cap for a team with 0 points — they can still answer with `bet = 0` for no points at stake)
- [x] When the bet exceeds the team's points, an info line on the gamemaster panel explains why submit is disabled
- [x] After submit, the game advances to the question phase — question rendering is identical to `simple-quiz` (images, audio, list, timer, colors, emoji-only large text, replaceImage)
- [x] A persistent banner above the question shows: team label, team member names (comma-joined), and the bet amount (e.g. "Team 1 · Alice, Bob · Einsatz: 12 Punkte")
- [x] The gamemaster reveals the answer with the standard Weiter (forward) nav, same as `simple-quiz`
- [x] After the answer is revealed, the gamemaster UI shows Richtig/Falsch buttons for the winning team only, plus a "Nächste Frage" / "Weiter" button
- [x] Richtig → dispatch `AWARD_POINTS` with `+bet` for the winning team; Falsch → dispatch with `-bet` (reducer already floors total at 0)
- [x] Changing the judgment (Richtig ↔ Falsch) before advancing correctly reverses the prior award (mirrors FinalQuiz's `judgeTeam` pattern)
- [x] The example question (`qIdx === 0`) does NOT award or deduct points regardless of judgment (matches `simple-quiz`/`final-quiz` example-question semantics)
- [x] Per-question state (selected team, bet, result) is reset between questions
- [x] After the last question, `onGameComplete()` is called and BaseGameWrapper skips directly to the next game (`skipPointsScreen: true`, like `final-quiz`) — no AwardPoints screen
- [x] Supports `randomizeQuestions` and `questionLimit` from `BaseGameConfig` with the same semantics as `simple-quiz` (example question preserved as index 0)
- [x] Validator: `bet-quiz` questions missing `category`, `question`, or `answer` produce a validation error
- [x] Back-navigation from the answer phase returns to the question phase (doesn't collapse the bet); back-navigation from the question phase returns to the category phase (bet is kept)
- [x] During the category phase, the bet input on the gamemaster syncs live to the frontend: each keystroke updates the bet shown in the on-screen input (via a `*:change` gamemaster-command emitted by inputs flagged `emitOnChange`)
- [x] The gamemaster card shows the question text above the answer (via `GamemasterAnswerData.question`) so the gamemaster can see both the question and the answer while the audience only sees the category

## State / data changes
- No `AppState` changes — phase/bet/team/result are local component state
- Read from `AppState`: `teams.team1`, `teams.team2`, `teams.team1Points`, `teams.team2Points` (for banner + hard-cap validation)
- Config type: `BetQuizConfig` in `src/types/config.ts`, extending `BaseGameConfig`
- Question type: reuses `SimpleQuizQuestion` with an added optional `category?: string` field (optional at the type level, required by `validateBetQuiz`)
- `GameType` union extended with `'bet-quiz'`
- `GameConfig` discriminated union extended with `BetQuizConfig`

## UI behaviour
- Component: `src/components/games/BetQuiz.tsx`
- Shared presentational component: `src/components/games/QuizQuestionView.tsx` — extracted from `SimpleQuiz` so both `SimpleQuiz` and `BetQuiz` render questions identically (images, audio controls, lists, timer, colors, emoji-only large text, lightbox)
- Phases within the `game` phase of `BaseGameWrapper`: `category` → `question` → `answer` → `judging` → next question (or `onGameComplete`)
- Category reveal: single large centered heading (class `.bet-quiz-category`) on the normal quiz-container background
- Question/answer phase: persistent banner above the question (class `.bet-quiz-banner`) — "Team X · Alice, Bob · Einsatz: 12 Punkte"
- Gamemaster controls per phase (via `setGamemasterControls`):
  - `category`: `button-group` for team selection (shows member names as part of labels), `input-group` for bet (single numeric field), submit `button` ("Frage anzeigen") with `disabled` when invalid, and an `info` line explaining any cap violation
  - `question`: nav only (BaseGameWrapper provides Weiter)
  - `answer`/`judging`: `button-group` with Richtig/Falsch for the winning team + Next button (disabled until judged)
- Keyboard nav works the same as `simple-quiz` — forward advances phase/question, back steps through phases
- Audio/timer behaviour inherited from `SimpleQuiz` via the shared view (audio plays from question phase, cuts between questions, fades at next game's landing per existing rules)

## Theme showcase
- `src/components/screens/ThemeShowcase.tsx` — add an example of the bet-quiz category screen and the team/bet banner so all themes can be verified at `/theme-showcase`

## Admin form
- `src/components/backend/questions/BetQuizForm.tsx` — mirrors `SimpleQuizForm` (reuses its patterns/components for images, audio, trim, list, colors, timer) plus a required `category` text input next to question/answer in the compact row
- `src/components/backend/InstanceEditor.tsx` — add `bet-quiz` branch that renders `BetQuizForm`

## Out of scope
- Automatic bet validation beyond the per-team points cap (no min bet, no "must be > 0")
- Separate spending caps per round or cumulative bet tracking
- Team buzzers / timed betting
- Showing both teams' bets on screen (the losing bet is never captured — teams write it on paper)
- Tiebreaker logic for equal bets (the gamemaster simply picks a team)
