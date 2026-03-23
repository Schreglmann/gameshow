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
- [x] Template files (`_template-*.json`) are excluded from the unused-file warning

## State / data changes
- No runtime state; this is a build/dev-time script only
- File: `validate-config.ts`
- Run via: `npm run validate`

## UI behaviour
- CLI output only: green "✓ Valid" on success, red error messages on failure
- No browser UI

## Out of scope
- Validation of question content (spelling, language, factual correctness)
- Runtime validation (the server assumes valid config)
- Validating `background-music/` filesystem content
