# Spec: Config System

## Goal
All gameshow content — which games run, in what order, with what questions — is driven entirely by `config.json` and `games/*.json` files, with no hardcoded data in application code.

## Acceptance criteria
- [x] `config.json` at the repo root defines global settings and a `gameshows` map
- [x] `activeGameshow` key selects which gameshow from `gameshows` is currently running
- [x] Each gameshow has a `name` (display) and `gameOrder` array of game identifiers
- [x] Game identifiers resolve to `games/<name>.json` files
- [x] Multi-instance games are referenced as `"<name>/<instanceKey>"` (e.g. `"allgemeinwissen/v1"`)
- [x] Instance fields in `games/<name>.json` → `instances.<key>` are deep-merged over the base game fields
- [x] The server re-reads `config.json` on every API request (no caching) to allow live edits
- [x] `config.template.json` provides a safe, non-encrypted starting point for new configs
- [x] `audio-guess` questions are auto-generated server-side from filesystem directories
- [x] Static assets (`/audio`, `/images`, `/audio-guess`, `/background-music`) are served by the Express server
- [x] Each gameshow may specify `enabledJokers: string[]` — the subset of joker IDs (from the hardcoded catalog at `src/data/jokers.ts`) that teams may spend during this gameshow; see [jokers.md](jokers.md)

## State / data changes
- No runtime state for config itself — fetched fresh per request
- `AppState.settings`: loaded once on app start from `GET /api/settings`
  - `pointSystemEnabled: boolean`
  - `teamRandomizationEnabled: boolean`
  - `globalRules: string[]`
  - `enabledJokers: string[]` (joker IDs from the active gameshow)
- `GET /api/game/:index` returns `GameDataResponse`:
  - `gameId: string`
  - `config: GameConfig`
  - `currentIndex: number`
  - `totalGames: number`
  - `pointSystemEnabled: boolean`

## UI behaviour
- No direct UI for config editing (use a text editor or `npm run generate`)
- Changing `activeGameshow` in `config.json` takes effect on the next page load or navigation

## Out of scope
- In-browser config editing
- Multiple simultaneous active gameshows
- Runtime config hot-reload without a page reload
