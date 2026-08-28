# Spec: Config Validation

## Goal
`npm run validate` checks all config and game files for structural correctness before the app runs, catching errors that would only surface at runtime.

## Acceptance criteria
- [x] Exits with code 0 when all configs are valid; exits with code 1 if any errors are found
- [x] Errors are printed with descriptive messages; all errors are collected before exiting (not fail-fast)
- [x] Validates that `config.json` exists and is valid JSON
- [x] Validates that `gameshows` object is present and contains at least one entry
- [x] Validates that `activeGameshow` value exists as a key in `gameshows`
- [x] Validates that each gameshow has a non-empty `name` and `gameOrder` array
- [x] Validates that each game identifier in `gameOrder` resolves to an existing `games/*.json` file
- [x] Validates that each game file is valid JSON
- [x] Validates that multi-instance references (`name/key`) resolve to an existing `instances.<key>` in the game file
- [x] Validates that each game has a `type` field matching a known game type, and a `title` field
- [x] Validates that games requiring questions have a non-empty `questions` array
- [x] Validates question field types per game type (e.g. `guessing-game` answer must be a number)
- [x] Warns (non-fatal) about game files in `games/` that are not referenced in any `gameOrder`
- [x] Generated example games (`games/beispiel-*.json`) are gitignored; when referenced by the active `beispiele` gameshow they validate like any other game
- [x] Validates that each gameshow's `enabledJokers` (if present) is an array of strings referencing IDs in the hardcoded joker catalog at `src/data/jokers.ts`; unknown IDs emit `unknown joker id "<id>"` errors
- [x] Validates that each gameshow's `teamCount` (if present) is an integer 0–4; anything else is an error
- [x] Warns when a gameshow sets `teamCount > 0` while the global `pointSystemEnabled` is `false` (the global switch wins — the show runs with no teams)
- [x] Warns, per `gameOrder` entry, when the game's type + `scoringMode` cannot be scored at that gameshow's team count — the game still plays, just without scoring. See [team-count.md](team-count.md)
- [x] The quizjagd supply check needs `questionsPerTeam × teamCount` playable questions and is a **warning**, not an error: one game file may be referenced by gameshows with different team counts, so a shortfall is a property of the pairing, not of the file

## State / data changes
- No runtime state; this is a build/dev-time script only
- File: `validate-config.ts` (imports `gameSupportsTeamCount` from `src/data/gameTypeInfo.ts`)
- Run via: `npm run validate`

## UI behaviour
- CLI output only: green "✓ Valid" on success, red error messages on failure
- No browser UI

## Out of scope
- Validation of question content (spelling, language, factual correctness)
- Runtime validation (the server assumes valid config)
- Validating `background-music/` filesystem content
