# Spec: Admin games list — sort and status filter

## Goal

The admin **Spiele** tab lists every game file. With 100+ games the operator needs to find the newest ones and the ones the current players have not played yet, without opening the Gameshows tab. The list gets a sort order and a status filter that use the same Neu / Ungespielt classification as the gameshow planning (see [game-planning.md](game-planning.md)).

## Acceptance criteria

- [x] Next to the search field is ONE sort + filter button, the same control as the Assets tab (`asset-sort-wrapper` / `asset-sort-popover` / `asset-sort-btn`). Its label is the current sort plus the direction arrow, followed by the active status filter in the accent colour (`Name ↓`, `Geändert ↓ · Neu`, `Name ↓ · Neu + Ungespielt`)
- [x] The popover's first section, headed **Sortierung**:
  - **Name** (default) — by title, German collation (`localeCompare(…, 'de')`), A→Z
  - **Typ** — by the type label shown in the Typ column (`GAME_TYPE_INFO[type].label`), A→Z, then by title
  - **Geändert** — newest `modifiedAt` first
  - **Erstellt** — newest `createdAt` first
  - **Status** — by the Status column, Neu → Ungespielt → Gemischt → Gespielt (the order of the gameshow's Planung panel), then by title within each status
  - Clicking the active sort again reverses its direction (`↓` natural, `↑` reversed); picking another sort resets to the natural direction
- [x] The column headings **Titel**, **Status**, **Typ** and the date heading (**Geändert** / **Erstellt**) are buttons that pick the same sorts as the popover (Titel = Name); clicking the active one reverses it. The active heading is accent-coloured and shows the direction arrow (`aria-sort` set). **Instanzen** is not sortable
- [x] Below a divider, a section headed **Filter** (not "Status", which is already a sort entry) with one toggle per status, **Neu**, **Ungespielt**, **Gemischt**, **Gespielt** (✓ when on, labels from `OVERLAP_BADGE_GAME`). None on = all games; any on = only games with one of those statuses. **Eingeplant** is not offered: the status is classified for the active gameshow itself (`buildOverlapContext(…, active, …, active)` has no planned shows), so it never occurs in this list
- [x] Status is computed against the **active gameshow**: its `players` roster and the gameshow timeline, via `buildOverlapContext(gameshows, activeGameshow, players, activeGameshow)` + `classifyGameOverlap(gameRefs(game), ctx)` — exactly the badge the gameshow's "Spiel hinzufügen…" picker shows for that game
- [x] `classifyGameOverlap` returns `null` when the active gameshow has no players and the game was played before; the list treats that as **Ungespielt** (nobody in the empty roster played it)
- [x] Every row shows the status as an overlap badge in a **Status** column, and — only under a date sort — a date column (`dd.mm.yyyy`, full timestamp as tooltip): **Geändert** (`modifiedAt`) under the Geändert sort, **Erstellt** (`createdAt`) under the Erstellt sort. Under Name and Status there is no date column
- [x] The Filter section, Status sort and Status column are hidden when the config has no active gameshow (nothing to classify against)
- [x] Sort, direction and status filter survive switching admin tabs (module-scope state in `GamesTab.tsx`, like `saveQueue`) and reset to the defaults on a page reload. The search text is not kept
- [x] Search, sort and filter combine; pressing Enter in the search still opens the game when exactly one row is visible
- [x] Rows with a JSON parse error have no status and sort last under the Status sort; they are hidden whenever a status filter is on
- [x] The list refreshes on `content-changed` for `games` (game list) and `config` (status)
- [x] Responsive: the Typ column is fluid (`clamp(140px, 16vw, 240px)`); below 576px the search takes a full-width line and the sort button and the new-game button share the next one, the new-game button moving to its own line when a long filter label leaves no room (it never wraps its text); the popover opens to the left edge, the date and Instanzen columns are hidden, Status and Typ get fixed narrow widths (Typ badge ellipsized) and rows grow with wrapped titles

## Timestamps

`GET /api/backend/games` adds two fields to each `GameFileSummary`, both epoch milliseconds:

- `modifiedAt` — the file's `mtime`
- `createdAt` — when the file was first added to git: the author time of the commit that added `games/<name>.json`, following renames (`git log --reverse --name-status -M --diff-filter=AR -- games`). A file git does not know yet (new, uncommitted, or renamed and uncommitted) falls back to `min(birthtime, mtime)`.

The file's own birthtime is not used for committed files: game saves write a tmp file and rename it over the original (`PUT /api/backend/games/:fileName`), so birthtime is the time of the last save, not of creation.

The git lookup runs once via `execFile` (5 s timeout, `'error'` handled by the callback) and is cached in memory for 60 s (`server/game-created-at.ts`). When git is missing or fails, every file uses the fallback and the list still loads.

## State / data changes

- `GameFileSummary.modifiedAt?: number`, `GameFileSummary.createdAt?: number` (`src/types/config.ts`, `specs/api/openapi.yaml`)
- Sort and filter are UI state of `GamesTab`, mirrored into a module-scope variable so a tab switch keeps them — not in `AppState`, not in `localStorage`

## Out of scope

- Per-instance rows (the list stays one row per game file; per-instance planning is the Planung panel)
- Picking a gameshow other than the active one to classify against
