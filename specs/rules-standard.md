# Spec: Canonical phrasing for game rules

## Goal

Every game's `rules` array in `games/*.json` uses the **same words** for the same mechanic. "Simultaneous write-down", "first correct answer wins", "alternating turns" should read identically across all games that use them. This is editorial, not mechanical — enforced by AI tools and reviewers consulting this document before writing or editing any `rules` array.

## Why this exists

Rules were authored game-by-game in isolation. The same idea ended up phrased 3–5 different ways ("bekommt den Punkt" vs. "bekommt die Punkte", "Beide Teams raten gleichzeitig" vs. "Die Teams raten gleichzeitig", "Sollte diese falsch sein, darf das Team nicht erneut raten" vs. "Wenn ein Team falsch liegt, kann das andere Team raten" — which mean *opposite* things). This document is the source of truth so that never happens again.

## How to use this spec

1. Before writing or editing a game's `rules` array, identify which **archetype** the mechanic matches (A/B/C, or X for special).
2. Start the array with a **task line** (game-specific, free-form, one sentence) describing what the players are guessing.
3. Append the archetype lines **verbatim** — do not reword them.
4. If the game has a special mechanic (bet-quiz, final-quiz, etc.), use the Archetype X patterns below and match the tone/verbs/punctuation of the other archetypes.

The `globalRules` in `config.json` already covers the show-level framing (multiple games, positional scoring, overall winner, round-winner default). Per-game rules must **not** restate those.

## Universal conventions

- **Voice:** third-person ("Die Teams", "Das Team"). Never "Ihr" / "Euch".
- **Verbs:** `raten` (to guess), `antworten` (to answer), `aufschreiben` / `schreiben auf` (to write down), `gewinnen` (to win). Do not introduce synonyms.
- **Plural:** "Punkte" (always plural), never "Punkt" / "den Punkt".
- **Sentence endings:** every rule ends with a period `.`.
- **Capitalization:** standard German.
- **No English words.** "Handzeichen", not "Handheben" / "hand raise".
- **Task line first.** One sentence, specific to the game, ending with a period.

## Archetypes

### Archetype A — Gleichzeitig schriftlich

Both teams see the same question at the same time, write their answer on paper / whiteboard, and reveal simultaneously.

```
<TASK LINE>.
Jede Frage wird beiden Teams gleichzeitig gestellt.
Die Teams schreiben ihre Antwort auf.
```

**Applies to:** most `simple-quiz` games, `fact-or-fake`, `q1`, `das-zweitmeiste`, `x-dinge-nennen`, `woher-kommt-es`, `promi-vornamen`, `trump-oder-hitler`, `feuerwehr-quiz`, `allgemeinwissen`, `abkuerzungen`, `automarken`, `was-war-vorher`, `harry-potter-trivia`.

**Example** (`woher-kommt-es.json`):
```json
"rules": [
  "Es geht darum, zu erraten, woher das genannte Produkt stammt.",
  "Jede Frage wird beiden Teams gleichzeitig gestellt.",
  "Die Teams schreiben ihre Antwort auf."
]
```

### Archetype B — Gleichzeitiges Raten (race)

Both teams see/hear the question at the same time; the first team to call out the correct answer wins. If the calling team is wrong, the other team may answer.

```
<TASK LINE>.
Beide Teams raten gleichzeitig.
Die erste Antwort eines Teams zählt.
Antwortet ein Team falsch, darf das andere Team antworten.
```

**Applies to:** `abba`, `bridgerton-soundtrack`, `gaming-soundtracks`, `buchstabensalat`, `emoji-raten`, `plot-guess`, `soundtracks`, `musicals`, `serienintros`, `uebersetzte-songtexte`, `audio-guess`, `bandle`, `harry-potter-erster-satz`, `colorguess`.

**Example** (`emoji-raten.json`):
```json
"rules": [
  "Gesucht ist ein Song, dargestellt durch Emojis.",
  "Beide Teams raten gleichzeitig.",
  "Die erste Antwort eines Teams zählt.",
  "Antwortet ein Team falsch, darf das andere Team antworten."
]
```

### Archetype C — Abwechselnd

Teams take turns; if the team whose turn it is can't answer or answers wrong, the other team may answer.

```
<TASK LINE>.
Die Teams raten abwechselnd.
Antwortet ein Team falsch oder nicht, darf das andere Team antworten.
```

**Applies to:** `filme-raten`, `logo-quiz`, `georgs-quiz`, `songtexte-vervollstaendigen`, `werbeslogans`, `harry-potter-soundtrack`.

**Example** (`logo-quiz.json`):
```json
"rules": [
  "Es muss die Firma anhand des Logos erraten werden.",
  "Die Teams raten abwechselnd.",
  "Antwortet ein Team falsch oder nicht, darf das andere Team antworten."
]
```

### Archetype X — Special mechanics

Games where the core mechanic is unique. The rules stay mechanic-specific but follow the universal conventions (third-person, period, no English, "Punkte").

**Bet-quiz** (`bet-quiz.json`):
```json
"rules": [
  "Vor jeder Frage wird die Kategorie enthüllt.",
  "Beide Teams setzen geheim einen Teil ihrer bisher verdienten Punkte.",
  "Das Team mit dem höheren Einsatz beantwortet die Frage.",
  "Bei richtiger Antwort gewinnt das Team den Einsatz dazu, bei falscher verliert es ihn."
]
```

**Final-quiz** (`final-quiz.json`):
```json
"rules": [
  "Jedes Team setzt seine bisher verdienten Punkte.",
  "Bei richtiger Antwort werden die gesetzten Punkte verdoppelt.",
  "Bei falscher Antwort verliert das Team die gesetzten Punkte."
]
```

**Quizjagd** (`quizjagd.json`):
```json
"rules": [
  "Die Teams sind abwechselnd am Zug.",
  "Jedes Team wählt 3, 5 oder 7 Punkte für eine leichte, mittlere oder schwere Frage.",
  "Bei richtiger Antwort gewinnt das Team die Punkte, bei falscher verliert es sie."
]
```

**Guessing-game** (`ratespiel.json`, `georgs-schaetzspiel.json`): closest-value wins a question; use "gewinnen die Frage" rather than the default winner line.
```json
"rules": [
  "<TASK LINE>.",
  "Jedes Team gibt seinen Tipp für jede Frage ab.",
  "Das Team, das näher an der richtigen Antwort liegt, gewinnt die Frage."
]
```

**Four-statements** (`four-statements`):
```json
"rules": [
  "<TASK LINE>.",
  "Die Lösung wird anhand von bis zu 4 Hinweisen erraten.",
  "Nach jedem Hinweis darf geraten werden."
]
```

**Ranking** (`ranking`):
```json
"rules": [
  "<TASK LINE>.",
  "Die Antworten sind in der richtigen Reihenfolge zu erraten.",
  "Das Team, das am weitesten kommt, gewinnt die Runde."
]
```

**Image-guess / video-guess / colorguess** (progressive reveal): use Archetype B with a task line describing the reveal mechanic.

## Empty `rules` arrays

An empty `rules: []` is allowed but discouraged. Prefer the canonical archetype for the game's mechanic. Only leave empty if the game is not currently playable (archive-only or author still deciding the mechanic).

## Relationship to `globalRules`

`globalRules` in [`config.json`](../config.json) carries the show-level framing:

- There are multiple games.
- Each round has a winner (default: most correct answers — games override if different).
- Positional scoring: first round is 1 point, second 2, etc.
- Team with most total points wins the show.

Per-game `rules` **must not repeat** any of those four statements.

## Acceptance criteria

- [ ] Every game whose mechanic matches Archetype A/B/C uses those exact lines verbatim.
- [ ] Every game's first rule is a task line ending with a period.
- [ ] No rule ends without a period.
- [ ] No rule says "bekommt den Punkt" (singular).
- [ ] No English words remain in any rule.
- [ ] No per-game rule restates the show-level framing (positional scoring, overall winner, round-winner default).
- [ ] `_template-*.json` files follow the same canonical phrasing for whichever archetype matches the template's game type.
