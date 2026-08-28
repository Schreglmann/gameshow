# Spec: Guessing Game

## Goal
Both teams submit a numeric guess; the team whose answer is closest to the correct number wins the round.

## Acceptance criteria
- [x] Question is displayed with a prompt for both teams to write/say a number
- [x] Host enters both teams' guesses into separate input fields on the game screen
- [x] After both guesses are entered, host reveals the correct answer
- [x] The team with the closer guess is highlighted as the winner
- [x] In case of an exact tie (both equidistant), both teams are shown as tied
- [x] Optional `answerImage`: shown after the correct answer is revealed
- [x] Optional `questionAudio`: auto-plays when the question is shown (e.g. "guess the release year of this song"). On-screen controls (timestamp, play/pause, restart) match simple-quiz's question audio; the gamemaster gets the same play/pause + restart buttons. Audio keeps playing through the result phase and stops when advancing to the next question; on game completion it fades out and the background music fades back in
- [x] The question audio can be trimmed: playback starts at `questionAudioStart`, stops at `questionAudioEnd`, and restarts at the start point when `questionAudioLoop` is set. The timestamp and the restart button are relative to the trimmed section. Admin picks the points on the shared `AudioTrimTimeline` waveform (the "✂ Trimmen" toggle in `GuessingGameForm`), and changing the audio file clears the trim
- [x] After the question, calls `onGameComplete()` (points awarded via `AwardPoints` — automatically decided unless `scoringMode: 'standard'`, see below)
- [x] Multiple questions per game are supported; host advances through them

## Acceptance criteria — automatic scoring (the default)
- [x] Automatic scoring is the **default** for this game type: it applies when `scoringMode` is absent
      or `'auto'`. This game always knows who was closer, so keeping score by hand was redundant
- [x] `scoringMode` is a game-level field, set in admin's game editor via the "Punktevergabe" dropdown
      (Automatisch / Manuell) — the same control bet-quiz and wer-kennt-mehr already use. `'standard'`
      is the explicit opt-out and is the ONLY value that keeps the manual behaviour above; picking
      "Automatisch" drops the field again rather than writing out the default
- [x] On every reveal the show writes the question's winner into the **shared per-question tally**
      (`correctAnswersByGame`, via `UPDATE_CORRECT_ANSWER`) — the very store the host used to fill by
      hand. That store persists, syncs to every gamemaster device over `gamemaster-question-tally`, and
      already feeds both the gamemaster's score boxes and "Wertung pro Frage", so no second record and
      no extra channel exists. `order` is passed to the wrapper so a live question edit re-keys the
      tally (`REMAP_QUESTION_TALLY`) instead of misattributing it
- [x] The write is a **diff against what the question already holds**, so re-judging a question — or a
      host correction in the score boxes — overwrites that question rather than counting it twice
- [x] Equidistant guesses count as a win for **both** teams; the example question (slot 0) never counts
- [x] The award screen opens on the verdict instead of asking: the winning team's card is already
      selected, the hint reads `"<Team> hat mehr Fragen gewonnen"` (or
      `"Unentschieden — beide Teams erhalten Punkte"`), each card shows the points it is about to
      receive (`+4 Punkte`, `0 Punkte` — a number for both teams) above the questions it won as a plain
      count (`2 gewonnene Fragen`), and "Punkte vergeben & weiter" books it. Deliberately **not**
      "x von y Fragen": a drawn question counts for both teams, so a fraction of the questions played
      stops adding up. The host can still toggle a card to override the verdict — the hint then falls
      back to the generic wording, and the tally is left untouched, so "Wertung pro Frage" keeps stating
      who was actually closer while the points follow the host. See [../point-system.md](../point-system.md)
- [x] The verdict is **derived from the tally**, not from component state: a team won a question when
      its bucket there is non-zero. So the host correcting a cell (a mistyped guess) moves the verdict,
      and back-navigating out of the game no longer loses the standing
- [x] **Starting the game from its title screen clears this game's tally** (`RESET_GAME_TALLY`), so a
      restart — or a second run of the same show — opens with an empty standing instead of the previous
      round's. Only that one game's bucket goes; team points and the score log are untouched. A game
      entered by back-navigation skips the title screen, so a review keeps its record
- [x] Only questions this playthrough actually **reached** count — the ceiling is
      `max(current question, getHighWater(gameId))`. The tally lives for the whole session, so a leftover
      record from an earlier playthrough of the same game position would otherwise contribute wins for
      questions that were never asked this time and silently change the award
- [x] Points are the **positional** game value (`currentIndex + 1`), awarded to the team with more
      question wins, or to both on an equal count. The Aufholjoker ×2 still applies: the wrapper's
      `ptsFor` computes what the screen states AND what it awards, so the two cannot diverge
- [x] With nothing judged yet (only the example played) there is no verdict — the award screen opens
      with nothing selected, exactly as for a game that never scored itself
- [x] The gamemaster keeps its familiar surfaces, now filled in automatically instead of by hand: the
      `CorrectAnswersTracker` boxes show the running standing per team (the game does NOT set
      `hideCorrectTracker`), and "Wertung pro Frage" lists every judged question — which is what that
      panel is for, and why the auto verdicts had to go into the tally rather than a private record.
      The GM's award screen shows the standing as one `info` line
      (`<T1>: 2 · <T2>: 0 → <T1> gewinnt`) above the shared team toggles + confirm button
- [x] Both surfaces are **read-only while an auto-scored game plays**: the game sets `autoScored`, the
      wrapper mirrors it as `tallyReadOnly` on the `gamemaster-controls` channel, and the `+`/`−` are
      **left out entirely** (not merely disabled — a dead button still invites the question of whether
      the host or the show awards a question). The counts themselves stay: they are the standing
- [x] A mis-entered guess is fixed by submitting the question again (its record is overwritten); the
      award screen can override who gets the points without touching the record, and once the points are
      booked the per-entry undo in "Letzte Wertungen" takes over. The read-only tally itself is never
      hand-edited while an auto-scored game plays

## State / data changes
- No new `AppState` fields — guess values stay local component state, and the per-question winners live
  in the existing `correctAnswersByGame` map (written with `UPDATE_CORRECT_ANSWER`, persisted to
  localStorage and broadcast on `gamemaster-question-tally` by the reducer, as for a manual tally). The
  derived verdict is handed to `BaseGameWrapper` via `setAutoAward` (see
  [base-game-wrapper.md](../base-game-wrapper.md))
- Config type: `GuessingGameConfig` in `src/types/config.ts`
  - `scoringMode?: 'standard' | 'auto'` — **defaults to `'auto'`** (absent means automatic; only
    `'standard'` opts out). Validated in `validate-config.ts` alongside the bet-quiz and
    wer-kennt-mehr allow-lists; schema in `specs/api/openapi.yaml`
- Question type: `GuessingGameQuestion`
  - `question: string`
  - `answer: number` (must be numeric — validated by `validate-config.ts`)
  - `answerImage?: string`
  - `questionAudio?: string` (auto-played during the question)
  - `questionAudioStart?: number` / `questionAudioEnd?: number` / `questionAudioLoop?: boolean` (trim, same semantics as simple-quiz)

## UI behaviour
- Component: `src/components/games/GuessingGame.tsx`
- Two numeric inputs, one per team, labelled clearly, side by side in a two-column grid (`.guess-fields`) so the pair stays visible next to the question audio player
- "Reveal" button shows correct answer and highlights the winning team
- Result layout (`.guess-result`): the correct answer in a card on top, both teams side by side in a two-column grid below it, then the optional `answerImage`, then "Nächste Frage". The verdict is a gold "Näher dran!" badge on the winning team's card (a neutral "Gleichstand!" badge on both cards when the guesses are equidistant) — there is no separate winner banner, so the guesses are never sandwiched between two result blocks
- Visual indicator (colour/border) on the winning team's result card
- With `questionAudio`: the standard `.audio-controls` bar (timestamp / play-pause / restart) renders between question and inputs; playback uses `safePlay` + `watchMediaLoad` (asset resilience) and preloads the next question's audio via `usePreloadAsset`
- Auto scoring (the default) changes nothing on the projector during play — the existing "Näher dran!" / "Gleichstand!" badges already state each question's verdict. It only changes how the shared award screen opens: the winner's `.award-team-card` is preselected (gold accent) and each card carries its won-question count, instead of the screen starting empty

## Out of scope
- Accepting non-numeric answers
- Editing the per-question tally by hand while an auto-scored game plays (the award screen's override
  changes who gets the points, never the record of who was closer)
- Allowing teams to change their guess after submission

## Known limitations
- The points a previous run of the same game already awarded stay in the team totals — starting the game again resets its per-question tally, not the score. Undo them in "Letzte Wertungen" or reset the show's points in admin

## Team count
- `standard` — **1–4 teams**: one guess input per team, the host picks the winner.
- `auto` — **2–4 teams**: the verdict is the smallest absolute difference, and **every** team tied at
  that minimum wins the question. "Closest guess" needs an opponent, so a solo show falls back to
  playing without scoring.

See [../team-count.md](../team-count.md).
