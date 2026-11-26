# Spec: Gamemaster info (`gmInfo`)

## Goal
Let the host attach a private note to any question (background facts, pronunciation, "accept also X")
that appears **only in the gamemaster card**, next to the answer, and is never rendered on the
show/projector.

## Acceptance criteria
- [x] Every question of every game type accepts an optional `gmInfo?: string`.
- [x] The GM card renders it as a block **under the answer, the answer image and the extra info,
  before the "Nächste Frage" preview**: label "Info für Gamemaster" plus the text.
- [x] Multi-line notes keep their line breaks (`white-space: pre-line`) inside one element.
- [x] The block is absent when `gmInfo` is unset or empty.
- [x] The block is **hidden while "Antworten verstecken" (`hideAnswers`) is on**, the same as the
  answer — the host may have turned the card towards the players.
- [x] The show never renders `gmInfo`. Only the per-question `setGamemasterData` call reads it.
- [x] Every question form in the admin has a field **"Info für Gamemaster (nur GM-Ansicht)"**.
- [x] `gmInfo` is proofread by the admin Korrektur tab.
- [x] `validate-config.ts` rejects a `gmInfo` that is not a string, for every type including quizjagd.
- [x] `specs/api/openapi.yaml` (all question schemas) and `specs/api/asyncapi.yaml`
  (`GamemasterAnswerData`) document the field.
- [x] The block is themed and responsive and appears in the GM card example at `/theme-showcase`.

## State / data changes
- Types: `GmInfoField { gmInfo?: string }` in `src/types/config.ts`; every question interface
  extends it (incl. `QuizjagdFlatQuestion`). `GamemasterAnswerData.gmInfo?: string` in
  `src/types/game.ts`.
- Show-side emission: each game's per-question `setGamemasterData` call adds `gmInfo: q.gmInfo`.
  The non-question GM screens (quizjagd difficulty pick, wer-kennt-mehr summary) do not.
- It travels as its own `gmInfo` key on the payload, **never merged into `extraInfo`**. That keeps
  it out of the answer-line highlighting.
- No server work: nothing between the game JSON and the game component strips keys.
- No `AppState` change, no new route or channel. Persisted to localStorage: no.

Game JSON:

```json
{ "question": "Wie heißt der längste Fluss der Welt?", "answer": "Nil", "gmInfo": "Knapp länger als der Amazonas. „Nil“ ohne Artikel gelten lassen." }
```

## UI behaviour
### GM rendering (`GamemasterView`)
- Markup: `.gamemaster-gm-info` > `.gamemaster-gm-info-label` + `.gamemaster-gm-info-text`.
- Placed after the answer, answer image and `.gamemaster-extra`, before `.gamemaster-next`.
- Gating: `data.gmInfo && !hideAnswers`. Also listed in
  [gamemaster-hide-answers.md](gamemaster-hide-answers.md).
- Style: left accent border, `clamp()` font sizes, GM theme tokens, no fixed widths.

### Admin
- One shared component, `GmInfoField` (`src/components/backend/questions/GmInfoField.tsx`), labelled
  "Info für Gamemaster (nur GM-Ansicht)", used in every question form. It is a spell-checked
  textarea and passes empty input up as `undefined`, so no empty `gmInfo` key lands in the JSON.
- A question that has only a `gmInfo` is not "empty" (the forms' empty-question checks include it).

### Spellcheck
`QUESTION_FIELDS` in `src/utils/spellcheckFields.ts` lists `{ kind: 'scalar', field: 'gmInfo', label: 'GM-Info' }`
for every game type. A unit test asserts every `GameType` has it.

### Validation
`validateQuestion` (all types but quizjagd) and `validateQuizjagd` (per pool question) report
`"gmInfo" must be a string` when the field is present and not a string.

## Not a secret
The show receives the full game config and builds the GM payload itself, so the note is visible in
the show's network traffic and in the payload forwarded over WebSocket. It is only **not rendered**
there, the same as `answer` before the reveal. Do not put anything in it that must stay hidden from
a player who opens the browser dev tools.

## Out of scope
- No `gmInfo` in the `nextAnswer` preview.
- No server-side stripping of the field from the show's responses.
- No per-note visibility toggle; it follows `hideAnswers`.
- Using `info` for host notes: `info` is a subtitle players see above the question.
