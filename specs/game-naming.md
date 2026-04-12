# Spec: Game Naming Improvements

## Goal
Streamline game creation and renaming so the user only enters a human-readable title, and the system derives the JSON filename automatically.

## Acceptance criteria
- [ ] NewGameModal asks for a "Name" (pretty title), not a raw filename
- [ ] Filename is auto-derived: lowercase, spaces/special chars → hyphens, German umlauts transliterated (ä→ae, ö→oe, ü→ue, ß→ss)
- [ ] Derived filename is shown as preview below the name input
- [ ] Created game JSON gets the pretty name as `title`
- [ ] When the title is changed in GameEditor and the field loses focus, the JSON file is renamed to match the new derived filename
- [ ] All `gameOrder` references across all gameshows in config.json are updated (including instance suffixes like `game/v1`)
- [ ] If the derived filename is the same as current, no rename happens
- [ ] If a file with the derived name already exists, an error is shown
- [ ] The editor continues working seamlessly after rename (new fileName propagated to parent)

## State / data changes
- New API endpoint: `POST /api/backend/games/:fileName/rename` → `{ newFileName: string }` → renames file + updates config refs
- No AppState changes (this is admin-only, backendApi)

## UI behaviour
- **NewGameModal**: single "Name" input (e.g. "Logo Farbenspiel"), filename preview below (e.g. `logo-farbenspiel.json`), game type selector unchanged
- **GameEditor**: title input triggers rename on blur when derived filename differs from current

## Out of scope
- Renaming instances within a game file
- Bulk rename
- Undo rename
