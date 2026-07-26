# Spec: Gamemaster Next-Answer Preview

## Goal
While the **current question's answer is revealed in the frontend**, also show the
**next question's answer** in the gamemaster (GM) card, so the host can read ahead and
prepare. The preview is always shown on reveal; it is suppressed only while the host has
hidden all answers via "Antworten verstecken" (see
[gamemaster-hide-answers.md](gamemaster-hide-answers.md)).

## Acceptance criteria
- [ ] The GM card shows the **current question text** above the current answer (the existing
  `.gamemaster-question` element, gated on `data.question`) for every game type that has a text
  question/prompt: simple-quiz, bet-quiz, final-quiz, guessing-game, video-guess, four-statements
  (topic), q1 (Frage), fact-or-fake (the statement), quizjagd, ranking, wer-kennt-mehr, random-frame.
  This is unconditional — it is shown during the question phase, not only on reveal. The
  media-guess types with no text question (audio-guess, bandle, image-guess, colorguess) show no
  question line.
- [ ] When the frontend reveals the current answer (`answerRevealed === true`), the GM card
  shows a "Nächste Frage" block below the current answer, containing the **next question's
  answer** plus its **question text** (when that game type has a question field).
- [ ] The preview only appears while the answer is revealed — it is not shown during the
  question phase before reveal, nor on the landing / rules / points screens.
- [ ] On the **last question** of a game (no following question) no preview block is shown.
- [ ] The preview is not shown while the host has hidden all answers via the
  **"Antworten verstecken"** toolbar toggle — see
  [gamemaster-hide-answers.md](gamemaster-hide-answers.md). There is no separate toggle for
  the preview alone.
- [ ] The preview works for every game type that iterates a linear `questions[]` list:
  simple-quiz, bet-quiz, final-quiz, guessing-game, audio-guess, video-guess, bandle,
  image-guess, colorguess, four-statements, q1, fact-or-fake, ranking.
- [ ] The preview is responsive (375 / 768 / 1024 / 1920px) and themed (visible at
  `/theme-showcase`).
- [ ] The preview is GM-only — it does not affect the player-facing `/show` projector, and no
  game JSON or `config.json` is mutated.

## State / data changes
- New optional field on `GamemasterAnswerData` (`src/types/game.ts`, broadcast over the
  existing `gamemaster-answer` WS channel):
  - `nextAnswer?: { question?: string; answer: string }` — the following question's answer,
    populated by each game from `questions[qIdx + 1]`. Undefined on the last question.
- Visibility is governed by the `hideAnswers` prop on `GamemasterView` (localStorage key
  `gm-hide-answers`) — see [gamemaster-hide-answers.md](gamemaster-hide-answers.md). The
  preview has no state of its own.
- API contract: `nextAnswer` added to the `GamemasterAnswerData` schema in
  `specs/api/asyncapi.yaml`.
- No new HTTP endpoints, no new WS channels, no `AppState` changes.

## UI behaviour
- Screen affected: `/gamemaster` (`GamemasterScreen` → `GamemasterView`), and the embedded
  `/admin#answers` iframe (which loads `/gamemaster`, so the toggle appears there too).
- Card: `.gamemaster-next` block rendered after the existing answer / extra-info, visually
  separated (top border + dimmer "Nächste Frage" label) so it is clearly distinct from the
  current answer. Shows the next question text (when present) and the next answer.
- Gating: render only when `!hideAnswers && controlsData.answerRevealed && data.nextAnswer`.

## Out of scope
- **Quizjagd**: turn-based easy/medium/hard pools have no well-defined linear "next question",
  so it does not populate `nextAnswer` and shows no preview.
- Next-answer **images** for the linear question types — the preview is text only there (next
  answer + next question text). The one exception is `random-frame`, which adds a next-frame
  image gated by "Bilder einblenden" (see [games/random-frame.md](games/random-frame.md)).
- A toggle for the preview alone — the former "Nächste Frage ausblenden" button was replaced by
  "Antworten verstecken" ([gamemaster-hide-answers.md](gamemaster-hide-answers.md)).
- Previewing more than one question ahead.
