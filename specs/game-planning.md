# Spec: Game Planning

## Goal

Each gameshow tracks which players are participating, and the admin can see at a glance which game instances those players have already played — so the operator knows which games to reuse and which to skip when building the game order.

## Acceptance criteria

- [x] Each game instance JSON file has a `_players` field: an array of strings, where each string is a comma-separated list of player abbreviations from one past session (e.g. `["St, Ju, Th", "An, Ko"]`)
- [x] Each `GameshowConfig` has an optional `players` field (`string[]`) listing the current participants
- [x] In the admin Config tab, each gameshow card has a **Players** field — a multi-value combobox where the operator picks participants
- [x] The combobox suggests all player names known from `_players` data across all game files; the operator can also type new names
- [x] Players are displayed as removable chips; typing and pressing Enter/comma adds a new name; Backspace removes the last chip
- [x] Each gameshow card has a **▼ Planung** toggle button that expands the planning overview
- [x] The planning overview lists every playable game instance (excluding `template`), sorted by overlap: **Neu** first, then **Ungespielt**, then **Teilweise**, then **Gespielt**
- [x] Each row in the planning overview shows:
  - An overlap badge (blue **Neu** / green **Ungespielt** / yellow **Teilweise** / red **Gespielt**)
  - The game title
  - The instance key (if multi-instance)
  - The past player sessions from `_players`, with players that overlap with the current gameshow's player list highlighted in yellow
  - A **+** button to add the instance directly to the gameshow's game order
- [x] The planning overview has a search field to filter by title or instance key
- [x] When players are set, each row in the existing game order list also shows an overlap badge
- [x] The `GET /api/backend/games` endpoint includes `instancePlayers: Record<string, string[]>` in each `GameFileSummary`, containing the `_players` array per instance

## Overlap logic

Given the current gameshow's `players` array and an instance's `_players` session array:

- **Neu** (`fresh`): no `_players` data exists — the game instance has never been played by anyone
- **Ungespielt** (`none`): `_players` data exists but no current player appears in any past session
- **Teilweise** (`partial`): some but not all current players have played
- **Gespielt** (`full`): every current player appears in at least one past session

Comparison is case-insensitive; names are trimmed before matching.

## State / data changes

- New field `players?: string[]` on `GameshowConfig` in `src/types/config.ts` — persisted in `config.json`
- New field `instancePlayers?: Record<string, string[]>` on `GameFileSummary` in `src/types/config.ts` — read-only, derived from game files at request time
- No new API endpoints; `GET /api/backend/games` response is extended

## UI behaviour

- Component affected: `src/components/backend/GameshowEditor.tsx`
- Players combobox sits between the gameshow name/ID line and the game order list
- Planning overview is hidden by default; toggled by the **▼ / ▲ Planung** button
- Adding a game via the planning overview appends it to `gameOrder` (same as the regular picker)
- If no players are set, overlap badges are hidden; all planning rows show **Neu**

## Out of scope

- Automatically removing or blocking already-played games from the game order
- Per-player statistics or history views
- Writing back to `_players` automatically when a gameshow is played (that remains a manual edit in the Games tab)
