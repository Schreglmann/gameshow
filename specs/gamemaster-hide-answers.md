# Spec: Gamemaster "Antworten verstecken"

## Goal
Let the host **turn the gamemaster screen towards the players** — or hand the device over, or
mirror it on a second screen — **without revealing any answers**. A GM toolbar toggle labeled
**"Antworten verstecken"** suppresses everything answer-bearing in the GM card while keeping
the question, the meta line and all controls usable. Per-device, persisted, **default off**.

This replaces the former "Nächste Frage ausblenden" toggle (hiding the next-question preview
alone was never needed in practice). The next-answer preview itself stays — see
[gamemaster-next-answer.md](gamemaster-next-answer.md) — it is simply suppressed while
answers are hidden.

## Acceptance criteria
- [ ] A toggle button in the GM toolbar, labeled **"Antworten verstecken"** (while answers are
  visible) / **"Antworten zeigen"** (while they are hidden), sits in the toggle cluster
  **between** the "Bilder einblenden" toggle and the "Pause-Bildschirm" toggle.
- [ ] The toggle is **off by default** (fresh `localStorage`: answers visible). Its highlight
  follows the normal convention of the lock / image toggles — unhighlighted while off,
  highlighted (`gm-answers-toggle--hidden`) while answers are hidden — and `aria-pressed`
  mirrors the hidden state. The choice persists across reloads (per-device).
- [ ] While active, the GM card suppresses **all answer-bearing content**:
  - the current answer (`.gamemaster-answer`),
  - the answer image (`.gamemaster-image`) — even when "Bilder einblenden" is on,
  - the extra-info block (`.gamemaster-extra`) — it carries the full `answerList` in
    simple-quiz / bet-quiz and `'Falsch: …'` in q1, so it is treated as answer content in
    full, accepting that its harmless parts ("Kategorie: …", "Platz 2/5", "Hinweis 3/4")
    disappear too,
  - the whole next-question preview block (`.gamemaster-next`, incl. its question text and
    image).
- [ ] Where the plain answer would be, a **dimmed hint line** reads "Antworten versteckt"
  (`.gamemaster-answer--hidden`), so a hidden answer can never be mistaken for a missing one.
- [ ] For a structured answer list (`ranking`, `data.answerList`) the rows stay **rendered and
  clickable** — they are the host's per-rank reveal control — with each answer text replaced by
  a neutral mask (`•••••`, `.gamemaster-answer-text--masked`). Rank chips and the
  `revealed` / `pending` states stay visible, and clicking a row still sends `rank-<n>`.
  No separate hint line is rendered in this case.
- [ ] A **hint list** (`city-compass`, `data.hintList`) is not answer content: its
  `revealed` rows stay legible while answers are hidden, because those cities are on the
  projector anyway. Only the **pending** rows — clues the host has not introduced yet — get
  the mask. The center city itself is hidden like any other answer, so the "Antworten
  versteckt" line still appears above the block. See [games/city-compass.md](games/city-compass.md).
- [ ] Everything that is **not** an answer stays visible: meta line, game title, the current
  question text, the current question image (`.gamemaster-question-image` — the random-frame
  still the players are guessing from), the controls panel, the correct-answers tracker, joker
  controls and the score history.
- [ ] Toggling has no player-facing effect: it does not sync over WebSocket, does not touch the
  `/show` projector, and mutates no game JSON or `config.json`.
- [ ] Responsive (375 / 768 / 1024 / 1920px) and themed — both toggle states and the hidden
  card state are visible at `/theme-showcase`.

## State / data changes
- New `localStorage` key (per-device, GM only): `gm-hide-answers` — `'true'` / `'false'`.
  **Absent value reads as `false`** (default: answers visible).
- New prop on `GamemasterView`: `hideAnswers?: boolean` (default `false`).
- Removed with the old toggle: the `gm-show-next-answer` key and the `showNextAnswer` prop.
- No `AppState` changes, no new WS channels, no HTTP routes, no payload changes — so
  `specs/api/openapi.yaml` / `specs/api/asyncapi.yaml` are unaffected.

## UI behaviour
- Screens affected: `/gamemaster` (`GamemasterScreen` → `GamemasterView`) and the embedded
  `/admin#answers` iframe (which loads `/gamemaster`, so the toggle appears there too).
- Toolbar: third toggle button (`.gm-answers-toggle` / `--hidden`) inside `.gm-toggle-group`,
  styled identically to the existing toggles (shared selector list in `gamemaster.css`).
- Card: the answer area renders either the answer (visible) or the dimmed hint line (hidden);
  the answer image, extra-info and next-answer blocks are simply not rendered while hidden.
- Gating in `GamemasterView`:
  - answer: `hideAnswers ? hint : data.answer`
  - answer list text: `hideAnswers ? '•••••' : item.text`
  - hint list text: `hideAnswers && !item.revealed ? '•••••' : item.text`
  - answer image: `data.answerImage && showAnswerImages && !hideAnswers`
  - extra info: `!hideAnswers && data.extraInfo`
  - next block: `!hideAnswers && controlsData.answerRevealed && data.nextAnswer`

## Out of scope
- Hiding the question, the question image, the controls panel, the tracker, the jokers or the
  score history — none of them give the answer away.
- Cross-device sync of the toggle (per-device only, like the lock / image toggles).
- A separate control for the next answer alone (deliberately removed).
- Any auto-hide behaviour (e.g. hide on idle) — the host toggles it explicitly.
