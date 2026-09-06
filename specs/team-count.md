# Spec: Dynamic team count (0–4 teams)

## Goal
Let a gameshow be played with **0, 1, 2, 3 or 4** teams instead of exactly two. Game types whose
mechanic does not survive the configured count stay fully playable — they just play **without
scoring** — and the operator is warned about that in the admin and on the show's start screen.

## Background
The app was built for exactly two teams: `TeamState` is parallel `team1*`/`team2*` fields, `TeamKey`
is `'team1' | 'team2'`, and "no teams" is the global `pointSystemEnabled: false`. Two existing
properties of the codebase make the generalization cheap:

1. **12 of 17 game types never name a team.** They pass `onAwardPoints` through to
   `BaseGameWrapper` and defer to the shared `AwardPoints` screen. Their two-team assumptions live
   entirely in `BaseGameWrapper.tsx`, `AwardPoints.tsx`, `correctAnswers.ts` and `questionScores.ts`.
2. **`pointSystemEnabled` is already a per-game value.** `GET /api/game/:index` returns it and
   `GameScreen` passes it into every game, and [point-system.md](point-system.md) already guarantees
   every game type is fully playable with it `false`. Gating that one server-side value on
   team-count compatibility is what "disable scoring for that game" is built from — no game
   component needs a compatibility check of its own.

## Model

### Team identity
`TeamKey` widens to `'team1' | 'team2' | 'team3' | 'team4'`. `TeamState` keeps the **flat**
`teamN*` field layout rather than moving to an array, so the localStorage keys, the WS payload and
the AsyncAPI schema stay purely **additive** and nothing has to be migrated. `team1*`/`team2*` stay
required; `team3*`/`team4*` are optional, and every read goes through the tolerant accessors in
[src/utils/teams.ts](../src/utils/teams.ts) (`teamPoints`, `teamRoster`, `teamJokersUsed`) so a
missing field reads as `0` / `[]`.

### Effective team count
```
teamCount = pointSystemEnabled === false ? 0 : (activeGameshow.teamCount ?? 2)
pointSystemEnabled (served)  = teamCount > 0
```
The global `AppConfig.pointSystemEnabled` therefore keeps working unchanged as the "0 teams" master
switch, and a gameshow with `teamCount: 0` behaves exactly like today's point-system-off mode.

### Per-game scoring gate
```
GET /api/game/:index → pointSystemEnabled =
    teamCount > 0 && gameSupportsTeamCount(config.type, teamCount, config.scoringMode)
```

## Acceptance criteria

### Configuration
- [ ] `GameshowConfig.teamCount?: 0 | 1 | 2 | 3 | 4` — omitted means `2`, so every existing
      gameshow is unchanged.
- [ ] `GET /api/settings` serves `teamCount` (effective, per the formula above) and keeps serving
      `pointSystemEnabled: teamCount > 0`.
- [ ] `GET /api/settings` serves `incompatibleGames: { index, title, type }[]` — the entries of the
      active gameshow's `gameOrder` whose type/scoringMode does not support the effective count.
      Empty at `teamCount: 0` (nothing scores anyway) and whenever everything fits.
- [ ] `GET /api/game/:index` returns `pointSystemEnabled: false` for an incompatible game even when
      the show has teams. No game component gains a compatibility check — each already implements
      the complete scoring-off play-through described in [point-system.md](point-system.md) §40.
- [ ] `GameFileSummary` gains `scoringModes?: Record<string, string>` (instance key → mode; the
      single-instance file uses the key `''`) so the admin can judge a `transfer` /
      `count-penalty` row without fetching every game file.

### Team count semantics

**0 and 1 are the two "no teams" counts.** Neither has a second team to split players between or
to compete against, so both suppress the whole team-assignment flow and the server forces
`teamRandomizationEnabled: false` for them (`hasTeamSplit()` in
[server/team-count.ts](../server/team-count.ts)) rather than leaving each client to special-case it.
What separates them is only whether points exist at all.

- [ ] **0 teams ≡ the point system off.** `effectiveTeamCount` already maps
      `pointSystemEnabled: false` to 0 and `GET /api/settings` serves back `pointSystemEnabled:
      teamCount > 0`, so the two are the same switch from either end. The gameshow runs purely to
      show the questions: no team UI on `HomeScreen` (just "Zum Starten klicken"), no team columns
      in the `Header`, jokers force-disabled, no award screen, no confetti, no randomization.
- [ ] **1 team — the audience plays the show, not each other.** The point system is ON: the host
      awards the positional points per game exactly as with two teams, and the `Header` shows the
      running score. But there are no *teams*: `HomeScreen` shows the same plain start prompt as at
      0 teams (no roster, no assignment, no "Teams tauschen"), and randomization is off. One award
      card; confirming it books the points, and confirm stays disabled until it is picked, so the
      host can only advance by deciding. There is no winner declaration on `SummaryScreen`, just the
      final score.
- [ ] **At 1 team the award screen is a confirmation, not a decision.** It still appears, but
      `preselectedWinners` in `BaseGameWrapper` arrives with the one card already selected, so
      confirm is live on entry and a single press books the positional points and advances. The host
      can still deselect it for a round the audience did not win, which disables confirm again — the
      normal empty-selection rule. A correct-answer tally still wins over this default, exactly as at
      2-4 teams. The card itself carries no name (there is no team) and shows its point value from
      the start instead.
- [ ] **The solo header is a centred PAIR**, not a three-column split: score and game counter side by
      side at the same size, the empty spacer dropped. One score in the left column with an invisible
      spacer holding the right read as a scoreboard missing its other half.
- [ ] **No team is NAMED below two teams.** `hasNamedTeams(count)` in
      [teamNames.ts](../src/utils/teamNames.ts) is the single predicate; every surface that would
      print a name checks it and shows the bare value instead: the `Header` label collapses to
      "7 Punkte" (no name, no colon), the award card reads "Punkte" and its hint asks "Wurde die
      Runde gewonnen?", `SummaryScreen` closes on the score alone, and the gamemaster's
      "Wertung pro Frage", correct-answers tracker, joker cards and "Letzte Wertungen" all drop
      their name column. The `team1` identity still exists underneath — it is only the LABEL that
      is suppressed — so a custom name set in the admin is still honoured everywhere.
- [ ] **The admin's global switches show the count's effect and lock.** In the Konfiguration tab,
      *Punktesystem aktiviert* is forced off and disabled at 0 teams, and *Team-Randomisierung
      aktiviert* at 0-1 teams, each with a note naming the reason. The STORED config values are
      left untouched, so raising the count back to 2 restores the operator's own choice rather than
      one the UI overwrote.
- [ ] **2 teams** — every surface renders exactly as before this feature. This is the regression
      bar: `teamDisplayOrder`, `AwardPoints`, `Header`, the Aufholjoker's trailing-team rule and the
      lead-change banner must all produce identical output at `teamCount: 2`.
- [ ] **3 / 4 teams** — all surfaces render N teams; awards, jokers, tallies and the score history
      work per team.
- [ ] `assignTeams` distributes the shuffled roster round-robin over the active teams
      (`i % teamCount`) instead of alternating between two.
- [ ] A team count above the number of players is allowed (teams may be empty).

### Compatibility matrix
Declared on `GameTypeInfo.supportedTeamCounts` in
[src/data/gameTypeInfo.ts](../src/data/gameTypeInfo.ts). Because `GAME_TYPE_INFO` is a
`Record<GameType, GameTypeInfo>`, `tsc` forces every type — including any future one — to declare it.

- [ ] `simple-quiz`, `q1`, `four-statements`, `fact-or-fake`, `audio-guess`, `video-guess`,
      `bandle`, `image-guess`, `colorguess`, `ranking`, `random-frame`, `city-compass`,
      `quizjagd`, `final-quiz` → `0,1,2,3,4`
- [ ] `guessing-game` → `0,1,2,3,4` in `standard`, `0,2,3,4` in `auto` ("closest guess" needs an
      opponent)
- [ ] `bet-quiz` → `0,1,2,3,4` in `standard`, **`0,2`** in `transfer` (zero-sum: the bet moves off
      *the* opponent, which is undefined with 3+ and impossible with 1)
- [ ] `wer-kennt-mehr` → `0,1,2,3,4` in `standard`, `0,2,3,4` in `count`, **`0,2`** in
      `count-penalty` (winner `+n` / loser `−n`)
- [ ] `gameSupportsTeamCount(type, count, scoringMode?)` is the single predicate, imported by the
      server, `validate-config.ts`, the admin and `HomeScreen`.

### Generalized mechanics
- [ ] **Quizjagd** — turn-taking rotates round-robin through the active teams; the per-team question
      counters become a record; the game ends when every team has had `questionsPerTeam` questions;
      `totalQuestions = questionsPerTeam * teamCount`.
- [ ] **FinalQuiz** — every active team places its own bet and is judged independently; the reveal
      gate is "every active team judged".
- [ ] **GuessingGame** — one guess input per team; the winner is the minimum absolute difference,
      and every team tied at that minimum wins the question.
- [ ] **BetQuiz** (`standard`) — the betting team is picked from N; `transfer` keeps its two-team
      zero-sum path and is declared 2-only.
- [ ] **WerKenntMehr** — the round-win recorder and the summary tally count per team; a `count`-mode
      tie splits `floor(n / selectedTeams)`.
- [ ] **AwardPoints** — one card per active team. Any subset may be selected; every selected team
      receives its points. Confirm stays disabled while nothing is selected. The hint reads
      "Welches Team hat gewonnen?" (nothing selected), "<Team> hat gewonnen" (one), or
      "Unentschieden — <A> und <B> erhalten Punkte" (two or more).
- [ ] **Aufholjoker** — eligibility becomes "any team strictly below the highest score" (identical
      to today's rule at two teams). Computed once in `trailingTeams()` rather than duplicated in
      `TeamJokers` and `GamemasterView`. See [comeback-joker.md](comeback-joker.md).
- [ ] **Lead change** — the `Führungswechsel!` banner fires when the *set of leading teams* changes
      (identical to the sign flip of `team1 − team2` at two teams). See [score-reveal.md](score-reveal.md).
- [ ] **SummaryScreen** — the winner is the team on the maximum score; several teams on the maximum
      is "Unentschieden". Confetti only for a unique winner and only when the point system is on.
- [ ] **`tallyLeader`** returns every team on the maximum non-zero count (so the award screen
      preselects a multi-way draw correctly).

### Display order
- [ ] `teamDisplayOrder(swapped, mirror, enabled, count)` returns a `TeamKey[]` of length `count`.
      `swapped` reverses the list; `mirror` (the gamemaster, which faces the crowd) reverses it
      again. At `count: 2` the output is identical to the previous 2-tuple for all inputs.
- [ ] The `Header` splits the ordered list around the game counter:
      `left = order.slice(0, ceil(N/2))`, `right = order.slice(ceil(N/2))`. N=1 → 1 left, empty
      right; N=2 → the current 1+1 layout; N=3 → 2+1; N=4 → 2+2.
- [ ] At 3-4 teams each side of the header is a COLUMN of team pills (team 1 over team 2, team 3
      over team 4), so exactly one team occupies each row and its jokers can only be read as its
      own. The two-team styling is otherwise untouched; the joker grid drops to a single row and
      type/padding step down so the taller side still fits the 2-team header's height. Below 768px
      it becomes one full-width column. Details in [header.md](header.md).
- [ ] Team cells stay readable at 375 / 768 / 1024 / 1920 px at every count; the header never
      scrolls horizontally.

### Warnings
- [ ] **Admin, gameshow card** ([GameshowEditor.tsx](../src/components/backend/GameshowEditor.tsx)):
      a **Teams** `<select>` (0–4, default 2, stored as `undefined` at 2) next to the Spieler row.
- [ ] **Admin, per `gameOrder` row**: an "Ohne Wertung" badge with a `title` naming the reason,
      styled like the existing "Deaktiviert" chip.
- [ ] **Admin, card level**: a `ConflictBanner` summarising how many games will play without
      scoring, shown only while at least one row is incompatible.
- [ ] **Admin, game editor**: a `.be-hint` under the Spieltyp select stating which team counts the
      selected type (and scoring mode) supports.
- [ ] **Show, `HomeScreen`**: a non-blocking banner listing the incompatible games, rendered after
      `CacheStatusBanner`, fed by `settings.incompatibleGames`. It stops click/keydown propagation
      so it cannot trigger the window-level "click anywhere to advance" listener.
- [ ] **Validator**: `teamCount` must be an integer 0–4 (error otherwise); one **warning** per
      `gameOrder` entry incompatible with that gameshow's count; the quizjagd question-count check
      uses `questionsPerTeam × teamCount` and is a warning (one game file may be referenced by
      gameshows with different counts).

## State / data changes
- `TeamKey` = `'team1' | 'team2' | 'team3' | 'team4'`; `MAX_TEAMS = 4`. New module
  [src/utils/teams.ts](../src/utils/teams.ts) — `teamKeys`, `teamKey`, `teamNumber`, `teamPoints`,
  `teamRoster`, `teamJokersUsed`, `leadingTeams`, `trailingTeams`.
- `TeamState` gains optional `team3`, `team4`, `team3Name`, `team4Name`, `team3Points`,
  `team4Points`, `team3JokersUsed`, `team4JokersUsed`. `ScoreLogEntry.team`,
  `TeamState.doubleNextGame` and `JokerTeam` widen to `TeamKey`.
- `QuestionTally` becomes `Partial<Record<TeamKey, number>>`; `BreakdownRow` carries
  `cells: Record<TeamKey, ScoreCell>`.
- `GlobalSettings` gains `teamCount: number` and `incompatibleGames: IncompatibleGame[]`.
- Config: `GameshowConfig.teamCount?: 0|1|2|3|4`. `AppConfig.pointSystemEnabled` is unchanged.
- localStorage: additive keys `team3`, `team4`, `team3Name`, …, `team4JokersUsed`. Existing keys
  keep their meaning; no migration.
- **WS channel renamed to `gamemaster-team-state-v2`** (was `gamemaster-team-state`). A stale cached PWA
  would normalize a 4-team payload down to two teams and re-broadcast it, silently destroying team
  3/4 rosters and points mid-show. Renaming makes an old peer simply fail to sync, which is
  visible — the same reasoning that renamed the correct-answers channel (see the comment block in
  [GameContext.tsx](../src/context/GameContext.tsx) above `CORRECT_ANSWERS_KEY`). No legacy
  migration; `serializeTeams` extends its positional array to cover the new fields.

## UI behaviour
- New: the `HomeScreen` incompatibility banner; the admin Teams select, row badge and card banner.
- Changed: `Header` (N cells split around the counter), `HomeScreen` team cards (each card's
  house-color accent ring comes from `--team1-house` … `--team4-house`; every theme that sets the
  accents must set all four, or a 3-4 team show draws accented cards next to plain ones — see
  [themes.md](themes.md)), `AwardPoints` (N cards), gamemaster team-setup controls,
  `SessionTab` (its fixed six-field editor becomes a loop), `CorrectAnswersTracker`,
  `QuestionScorePanel`, `GamemasterView` joker cards, `SummaryScreen`.
- `ThemeShowcase` gains a multi-team header, a 4-card award screen, a 4-card team-card row (so all
  four house accents are verifiable) and the warning banner so all themes stay verifiable at
  `/theme-showcase`.

## Out of scope
- More than 4 teams.
- Per-team colours or avatars beyond the `--teamN-*` theme variables.
- Predefining team names or memberships in `config.json` (names still live only in live team state).
- Generalizing the two genuinely head-to-head mechanics: `bet-quiz` `transfer` and `wer-kennt-mehr`
  `count-penalty` stay 2-only by design.
- Changing the team count mid-show (it is read from the active gameshow at settings load; a live
  config edit re-fetches settings, but points already booked to a now-inactive team are not migrated).
