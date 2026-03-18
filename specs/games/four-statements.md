# Spec: Four Statements

## Goal
Four statements are shown about a topic — three are true, one is false — and teams must identify the false statement.

## Acceptance criteria
- [x] Four statements are displayed simultaneously on screen
- [x] Three statements are true (`trueStatements[]`); one is the wrong statement (`wrongStatement`)
- [x] The order of the four statements is randomised each time (so the wrong one isn't always in the same position)
- [x] Teams confer and the host selects which statement they believe is false
- [x] Host reveals the correct answer (the wrong statement is highlighted)
- [x] Optional `answer` field: additional explanation text shown after reveal
- [x] After each question, host advances; after the last question, calls `onGameComplete()`
- [x] Multiple questions per game are supported

## State / data changes
- No `AppState` changes
- Config type: `FourStatementsConfig` in `src/types/config.ts`
- Question type: `FourStatementsQuestion`
  - `Frage: string` — the topic/question prompt
  - `trueStatements: string[]` — exactly 3 true statements
  - `wrongStatement: string` — the one false statement
  - `answer?: string` — optional post-reveal explanation

## UI behaviour
- Component: `src/components/games/FourStatements.tsx`
- Four labelled boxes (A/B/C/D or 1–4); statements displayed inside
- Clickable — host can click a statement to highlight it as the "selected wrong one"
- On reveal: the actual wrong statement is highlighted (e.g. red border); others turn green
- Reveal triggered by host keypress or button

## Out of scope
- Teams independently selecting answers on separate devices
- More or fewer than four statements
- Weighted scoring (partial credit for almost-correct)
