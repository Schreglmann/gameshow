# Spec: Config Generation

## Goal
`npm run generate` provides an interactive CLI wizard so non-developers can create new game files and add them to the active gameshow without manually editing JSON.

## Acceptance criteria
- [x] Prompts for game type (selection from all valid types)
- [x] Prompts for game title
- [x] Prompts for rules (optional, repeatable)
- [x] Prompts for questions appropriate to the selected type (repeating until the user is done)
- [x] Writes the resulting game JSON to `games/<slug>.json`
- [x] Appends the new game identifier to the `gameOrder` of the active gameshow in `config.json`
- [x] Runs `npm run validate` automatically after writing to confirm the new file is valid
- [x] Does not overwrite an existing game file without confirmation

## State / data changes
- No runtime state; dev-time script only
- File: `generate-config.ts`
- Run via: `npm run generate`
- Writes to: `games/<slug>.json`, `config.json`

## UI behaviour
- Interactive CLI (stdin/stdout) using prompts
- Confirmation before any destructive action (overwrite)
- Final summary of what was written

## Out of scope
- Generating multi-instance game files
- Editing existing game files
- Adding filesystem-based games (`audio-guess`) — those are configured by adding files to the relevant directory
