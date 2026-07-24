# Spec: Gamemaster Next-Answer Preview

## Goal
While the **current question's answer is revealed in the frontend**, also show the
**next question's answer** in the gamemaster (GM) card, so the host can read ahead and
prepare. The preview is toggleable from a GM toolbar button placed between
"Bilder einblenden" and the "Countdown" row, **on by default**, persisted per-device.

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
- [ ] A toggle button in the GM toolbar, labeled **"Nächste Frage ausblenden"** (when on) /
  **"Nächste Frage einblenden"** (when off), sits **between** the "Bilder einblenden" toggle
  and the "Countdown" deadline row. (Labeled "Frage" not "Antwort" because the block shows the
  next question's text alongside its answer.)
- [ ] The toggle is **on by default** (fresh `localStorage`). Its highlight is **inverted**
  relative to the lock/image toggles: the default/on state is **unhighlighted** (resting), and
  the button only becomes highlighted (`gm-next-toggle--hidden`) once the host clicks it to
  **hide** the preview. Toggling it off hides the preview; the choice persists across reloads
  (per-device).
- [ ] The preview works for every game type that iterates a linear `questions[]` list:
  simple-quiz, bet-quiz, final-quiz, guessing-game, audio-guess, video-guess, bandle,
  image-guess, colorguess, four-statements, q1, fact-or-fake, ranking.
- [ ] The preview is responsive (375 / 768 / 1024 / 1920px) and themed (visible at
  `/theme-showcase`).
- [ ] The feature is per-device only — it does not sync over WebSocket and does not affect the
  player-facing `/show` projector. No game JSON or `config.json` is mutated.

## State / data changes
- New optional field on `GamemasterAnswerData` (`src/types/game.ts`, broadcast over the
  existing `gamemaster-answer` WS channel):
  - `nextAnswer?: { question?: string; answer: string }` — the following question's answer,
    populated by each game from `questions[qIdx + 1]`. Undefined on the last question.
- New `localStorage` key (per-device, GM only): `gm-show-next-answer` — `'true'` / `'false'`.
  **Absent value reads as `true`** (default on).
- New prop on `GamemasterView`: `showNextAnswer?: boolean` (default `true`).
- API contract: `nextAnswer` added to the `GamemasterAnswerData` schema in
  `specs/api/asyncapi.yaml`.
- No new HTTP endpoints, no new WS channels, no `AppState` changes.

## UI behaviour
- Screen affected: `/gamemaster` (`GamemasterScreen` → `GamemasterView`), and the embedded
  `/admin#answers` iframe (which loads `/gamemaster`, so the toggle appears there too).
- Toolbar: third toggle button (`.gm-next-toggle` / `--showing`) between
  `AnswerImagesToggleButton` and `DeadlineButtons`, styled identically to the existing toggles.
- Card: `.gamemaster-next` block rendered after the existing answer / extra-info, visually
  separated (top border + dimmer "Nächste Frage" label) so it is clearly distinct from the
  current answer. Shows the next question text (when present) and the next answer.
- Gating: render only when `showNextAnswer && controlsData.answerRevealed && data.nextAnswer`.

## Out of scope
- **Quizjagd**: turn-based easy/medium/hard pools have no well-defined linear "next question",
  so it does not populate `nextAnswer` and shows no preview.
- Next-answer **images** — preview is text only (next answer + next question text).
- Cross-device sync of the toggle (per-device only, like the lock / image toggles).
- Previewing more than one question ahead.
