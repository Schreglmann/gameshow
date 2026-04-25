# Skill: Add New Game (data file only)

You are helping the user add a **new game data file** under [games/](../../games/) — a new instance of an existing game type, populated with questions. This is a content-only addition: no new TypeScript types, no React components, no server code, no config changes.

**Scope rules — non-negotiable:**

| Rule | Detail |
|------|--------|
| Only one file is created | `games/<slug>.json`. Nothing else changes. |
| Do **NOT** touch [config.json](../../config.json) | The new game is *not* added to any `gameOrder`. The user wires it into a gameshow themselves via the admin UI when they want to use it. `config.json` is git-crypt encrypted — never edit it. |
| `v1` instance is **empty** | `instances.v1.questions` is `[]`. |
| All questions go into the `archive` instance | This mirrors the established pattern used by `harry-potter-trivia.json`, `allgemeinwissen.json`, `minecraft-trivia.json`, and ~30 other games. |
| Game type must be one that already exists | If the user wants a new game *type*, redirect them to the [add-gametype skill](../add-gametype/SKILL.md). |
| Content is German | Title, rules, questions, answers — all German. Per [AGENTS.md §7](../../AGENTS.md). |
| File ends with trailing newline | Per AGENTS.md JSON rule. |

If a request needs anything beyond writing one JSON file (new game type, server changes, config wiring), stop and tell the user this skill won't cover it.

---

## Phase 1 — Gather requirements

Ask the user for:

1. **Game title** (German, e.g. `"Minecraft Trivia"`) — appears in the admin UI and as the screen heading.
2. **File slug** (kebab-case, e.g. `minecraft-trivia`) — becomes the file name `games/<slug>.json`. Default: derived from the title (lowercase, spaces → hyphens, strip umlauts). Confirm with the user before writing.
3. **Game type** — must be one of the existing types listed in [AGENTS.md §5](../../AGENTS.md). Most common for trivia-style content: `simple-quiz`. If unsure which type fits, briefly describe each candidate and let the user pick.
4. **Question topic / source** — what subject the questions cover, and whether the user supplies them, wants them generated, or wants them sourced from a list they'll provide.
5. **Question count** — typical archives hold 30–60 questions. Ask if not specified.
6. **Difficulty level** — easy / medium / hard / mixed. Affects question selection but not file shape.

Do not write the file until all six are clear.

---

## Phase 2 — Identify the rules archetype

Open [specs/rules-standard.md](../../specs/rules-standard.md) and pick the archetype matching how the chosen game type is played:

- **Archetype A** (gleichzeitig schriftlich) — most `simple-quiz` content
- **Archetype B** (gleichzeitiges Raten / race) — audio-guess, bandle, etc.
- **Archetype C** (abwechselnd) — alternating turns
- **Archetype X** — special mechanics (bet-quiz, final-quiz, quizjagd)

Cross-check by opening an existing game of the same type (e.g. [games/harry-potter-trivia.json](../../games/harry-potter-trivia.json) for `simple-quiz`) and confirm the archetype matches.

Compose the `rules` array as: **task line first** (game-specific, one sentence, ends with period), then the archetype lines copied **verbatim** from the spec. Do not paraphrase.

---

## Phase 3 — Identify the question shape

For the chosen `type`, find the canonical question fields by reading **both**:

1. [GAME_TYPES.md](../../GAME_TYPES.md) — describes every game type with config examples and field tables.
2. [games/_template-\<type\>.json](../../games/) — the type-level template (e.g. `_template-simple-quiz.json`).
3. [src/types/config.ts](../../src/types/config.ts) — the `<Type>Question` interface is the source of truth for required vs optional fields.

Note required fields, optional fields (e.g. `info`, `questionImage`, `answerImage`, `questionAudio`, `answerList`, `timer`, `category`), and any per-type validation rules.

Note: the `_template-*.json` files use a single `template` instance. The new file uses `v1` (empty) + `archive` (filled) instead — this is intentional and matches every active game in `games/`.

---

## Phase 4 — Write the file

Create exactly one file: `games/<slug>.json`.

```json
{
  "type": "<game-type>",
  "title": "<TITLE>",
  "rules": [
    "<task line ending with .>",
    "<archetype lines, verbatim from specs/rules-standard.md>"
  ],
  "instances": {
    "v1": {
      "questions": []
    },
    "archive": {
      "questions": [
        { "question": "...", "answer": "..." }
      ]
    }
  }
}
```

Rules:

- 2-space indent (matches [games/harry-potter-trivia.json](../../games/harry-potter-trivia.json), the canonical reference for this pattern).
- Trailing newline at end of file.
- Every question follows the shape from Phase 3. Omit optional fields when not used.
- One canonical short answer per question for `simple-quiz`-style games — host judges responses against it.
- For games with images / audio: paths are absolute web paths under `/images/...` or `/audio/...`. Reference assets that already exist; do not invent files.

---

## Phase 5 — Verify

Run:

```bash
npm run validate
```

This validates `config.json` plus every `games/*.json`. The new file must pass without errors. Common failures:

- Missing required fields on a question (per the type's `<Type>Question` interface).
- Invalid `type` string (must match an existing entry in `VALID_GAME_TYPES` in [validate-config.ts](../../validate-config.ts)).
- Trailing newline missing.

Spot-check after validation:

- File parses as JSON.
- `instances.archive.questions.length` matches the count agreed in Phase 1.
- `instances.v1.questions.length === 0`.
- Rules array length and phrasing match the chosen archetype exactly.

No tests need to run — content additions don't change shared code.

---

## What this skill explicitly will NOT do

- Add the new game to any gameshow's `gameOrder` in `config.json`. (User does that via [admin UI](../../specs/admin-backend.md) → Config tab.)
- Create a new game type. (Use [add-gametype](../add-gametype/SKILL.md).)
- Modify `validate-config.ts`, `GAME_TYPES.md`, `AGENTS.md`, `MODULAR_SYSTEM.md`, or anything in `src/`, `server/`, `tests/`.
- Generate placeholder questions to "fill" the archive. If the user hasn't supplied questions or a topic, pause and ask — never invent filler content.
- Download or generate image / audio assets. Reference only assets that already exist under [images/](../../images/) or [audio/](../../audio/).
