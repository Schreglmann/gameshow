# Spec: Base Game Wrapper

## Goal
Every game component shares an identical phase flow (landing → rules → game → award points → next game) managed by a single wrapper, so individual game components only implement the game logic itself.

## Acceptance criteria
- [x] All game components are wrapped in `<BaseGameWrapper>` — no game renders without it
- [x] Phase order: `landing` → `rules` (if game has rules) → `game` → `award-points` (if `pointSystemEnabled`) → navigates to next game
- [x] `rules` phase is skipped when `rules.length === 0` — landing transitions directly to game
- [x] `award-points` phase is skipped when `pointSystemEnabled` is `false`
- [x] Any click, Space key, or ArrowRight advances the phase from `landing` to `rules` / `game`
- [x] Back (ArrowLeft key / gamemaster "Zurück") walks the phases in reverse: `game → rules → landing`. On the `game` phase the active game's registered `backNavHandler` may consume the press first (step its own sub-state) before the wrapper falls back to `rules` / `landing`. On the `landing` phase, back invokes `onPrevGame` (always — for every game); the parent (`GameScreen`) decides the destination: the previous game, or the global rules / start page on the first game — see [app-navigation-flow.md](app-navigation-flow.md)
- [x] The gamemaster back control is always shown on the `landing` / `rules` phases (back is always possible from within a game)
- [x] The game component signals completion by calling `onGameComplete()` callback
- [x] After `onGameComplete()`, the wrapper transitions to `award-points` or navigates forward
- [x] After points are awarded (or skipped), the wrapper navigates immediately and automatically to `?index=N+1` or `/summary` — there is no intermediate "proceed to next game" screen. (The award screen's own confirm button is part of that screen, not an extra step after it)
- [x] Keyboard navigation is handled by `useKeyboardNavigation` hook — not inline event listeners
- [x] Per-question state (GM deadline timer, fullscreen overlay, paused-media resume state, `answerRevealed`) is cleared when the question **changes** — but NOT when a live question add/remove merely shifts the current question's index
- [x] A game that scored itself can hand the wrapper a finished verdict via the child-bag setter `setAutoAward({ team1Wins, team2Wins, scoredQuestions, winners })` (first user: guessing-game, where automatic scoring is the default — see [games/guessing-game.md](games/guessing-game.md)). The award screen **preselects** those winners and states the wins per team, so the host only confirms — but can still override by toggling a card. `null` leaves the preselection to the gamemaster's tally
- [x] The points an auto verdict states are the ones it awards: `ptsFor` (positional value, doubled for an armed Aufholjoker) is computed once and used both for the display and for `handleComplete`
- [x] A game that scores itself also passes `autoScored`, which the wrapper mirrors as `tallyReadOnly` on the `gamemaster-controls` channel so the gamemaster's tally surfaces render read-only. Starting such a game from its **title screen** also dispatches `RESET_GAME_TALLY` for its game index, so a restarted game opens with an empty standing (a back-navigated review enters the game phase directly and keeps its record)
- [x] The award screen's selection lives in the wrapper (not in `AwardPoints`, which is presentational), because the wrapper also builds the gamemaster controls and receives its commands. It is `picked ?? autoAward?.winners ?? tallyLeader(<this game's tally>) ?? nothing`, and it resets whenever the phase leaves `points` so it cannot leak into the next game
- [x] In the `points` phase the gamemaster mirrors the show: an `award-selection` button-group of team toggles (`award-toggle-team1` / `award-toggle-team2`, `active` reflecting the show's cards) plus an `award-confirm` button that is disabled while nothing is selected, preceded by the `award-auto-summary` `info` line when the game supplied a verdict. The pre-toggle ids (`award-team1` / `award-team2` / `award-draw` / `award-auto`) are still honoured as an immediate award, because the three PWAs are cached separately and a gamemaster on an older bundle still emits them

## State / data changes
- Phase state is local to `BaseGameWrapper` (not in `GameContext`) — intentional, ephemeral
- Optional `order?: QuestionOrderHandle` prop (from the game's `useQuestionOrder`). Passed by every game that tracks a question index. Two uses, both described in [live-question-order.md](live-question-order.md):
  - the per-question reset above keys on a **question token** (`order.slotKeys[questionNumber]`) rather than on `questionNumber`, so a compensating index shift doesn't tear down a running question. Falls back to `questionNumber` when no `order` is given
  - on an `order.revision` bump it dispatches `REMAP_QUESTION_TALLY`, re-keying the per-question correct-answer tally ([gamemaster-question-scores.md](gamemaster-question-scores.md))
- `GameContext.currentGame` is updated by `GameScreen` before the wrapper renders
- Navigation is performed via React Router `useNavigate`

## UI behaviour
- `landing` phase: game title card; click or keypress to continue
- `rules` phase: list of rules from `config.rules`; click or keypress to continue
- `game` phase: renders the child game component
- Back navigation: reverses the phase flow (`game → rules → landing`); pressing back on `landing` invokes `onPrevGame`, which the parent routes to the previous game (or, on the first game, out to the global rules / start page)
- `award-points` phase: renders `<AwardPoints>` — one toggleable card per team (`.award-teams`) with the points it would receive, above the confirm button that books them and navigates on. Selecting is not awarding: only the confirm press books points and advances
- Transitions are immediate (no animation)

## Out of scope
- Per-game phase customisation (e.g. skipping landing)
- Animated transitions between phases
- Persisting phase history across game changes (going back to a previous game reopens it at its landing screen, not where it was left)
