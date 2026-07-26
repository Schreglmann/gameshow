# Spec: Game Planning

## Goal

Each gameshow tracks which players are participating, and the admin can see at a glance which game instances those players have already played (or will play) — so the operator knows which games to reuse and which to skip when building the game order. The played-history is **derived from the gameshow configs themselves**, not from any manually-maintained per-game field.

## Model

"Player X has played instance Y" is derived: a player is part of a gameshow (`GameshowConfig.players`) and therefore played every game in that gameshow's `gameOrder`.

Time is modelled by **config order** (`Object.keys(config.gameshows)`, oldest → newest) with the **active gameshow** (`config.activeGameshow`) marking **"now"**: gameshows before the active one have already happened; the active one and everything after are upcoming.

When viewing gameshow **G**:

- **played shows** — shows that have happened *and* are before G (`index < min(indexOf(G), indexOf(active))`). These are the already-played history.
- **planned shows** — upcoming shows scheduled *earlier in the list than G* (`indexOf(active) ≤ index < indexOf(G)`). A game queued in one of these — sharing a player — is **Eingeplant**: not yet played, but already scheduled ahead of G.
- **G itself and every show after G** are excluded.

This is why, when **two upcoming shows use the same game** with an overlapping player, the **earlier** show shows Neu/Ungespielt and the **later** show(s) show **Eingeplant** — so you can spot and avoid the duplicate.

## Acceptance criteria

- [x] Each `GameshowConfig` has an optional `players` field (`string[]`) listing the current participants
- [x] In the admin Config/Gameshows tab, each gameshow card has a **Spieler** field — a multi-value combobox where the operator picks participants
- [x] The combobox suggests all player names known from **every gameshow's `players`** list; the operator can also type new names
- [x] Players are displayed as removable chips; typing and pressing Enter/comma adds a new name; Backspace removes the last chip
- [x] Each gameshow card has a **▼ Planung** toggle button that expands the planning overview
- [x] The planning overview lists every playable game instance (excluding `template` and `archive`), sorted by overlap: **Neu** first, then **Ungespielt**, then **Eingeplant**, then **Teilweise**, then **Gespielt**. Archive is always excluded here
- [x] Each row in the planning overview shows:
  - An overlap badge (blue **Neu** / green **Ungespielt** / purple **Eingeplant** / yellow **Teilweise** / red **Gespielt**)
  - The game title and the instance key (if multi-instance)
  - The **provenance**: which past gameshows played the instance ("Gespielt · «Show»") and which following gameshows have it queued ("Eingeplant · «Show»"), each with the overlapping current-roster members highlighted
  - A **+** button to add the instance directly to the gameshow's game order
- [x] The planning overview has a search field to filter by title or instance key
- [x] When players are set, each row in the existing game order list also shows an overlap badge
- [x] Games already in the current gameshow's `gameOrder` appear in the planning overview with the **+** button disabled and the row dimmed; tooltip "Bereits hinzugefügt". Already-added rows keep their sort position.
- [x] In the "Spiel hinzufügen…" combobox, games with any ref already in `gameOrder` are filtered out entirely. Adding a second instance of the same game is done via the Planung panel.

## Overlap logic

Given gameshow G's `players` roster `P` and a ref `R` (first match wins):

- **full** (`Gespielt`): every player in `P` played `R` in a *played show* (happened, before G)
- **partial** (`Teilweise`): some but not all of `P` played `R` in a played show
- **planned** (`Eingeplant`): `R` is not played by `P` yet, but a *planned show* (upcoming, earlier than G) sharing a player with `P` has `R` in its `gameOrder`
- **none** (`Ungespielt`): `R` was in a played show, but by nobody in `P`
- **fresh** (`Neu`): never in a played show and not planned earlier

Comparison is case-insensitive; names are trimmed. If no players are set, `planned`/`partial`/`full` cannot occur; a played-show game is `none` and everything else is `fresh` (badges for non-fresh are hidden when no roster is set).

**Already-played gameshows hide all overlap badges.** When the gameshow card being viewed is itself before the active gameshow in config order (it has already happened), the planning aids no longer apply, so the overlap badges + provenance are hidden everywhere in that card (game-order rows, comboboxes, Planung overview). Only the active gameshow and upcoming ones show badges.

## Game editor: "Bereits gespielt von"

The game editor (`GameEditor` → `InstanceEditor`) shows, per instance, a read-only derived list of which gameshows used that exact instance and their rosters — split into **Bereits gespielt** (happened shows) and **Eingeplant** (upcoming shows). Backed by `instanceUsage(ref, gameshows, activeGameshow)` in `src/utils/playerStats.ts`; `GameEditor` loads `gameshows` + `activeGameshow` from `fetchConfig()` and passes the per-instance result down as the `instanceUsage` prop.

Each **player name in that display is clickable** and opens the player-profile modal (`PlayerStatsModal`) inline in the game editor (`GameEditor` loads the games list via `fetchGames()` for title resolution and passes `onPlayerClick`). The modal's gameshow links hand off the target id via `sessionStorage['focus-gameshow']` and switch to the Gameshows tab, which consumes it once loaded to expand + scroll to that card.

## State / data changes

- `players?: string[]` on `GameshowConfig` (`src/types/config.ts`), persisted in `config.json`
- **No** per-game player field, **no** API changes. Derivation is entirely client-side from the `config.gameshows` record already available in the Gameshows tab.
- Shared pure helpers live in `src/utils/playerStats.ts`: `buildOverlapContext` (takes `gameshows`, `currentId`, `currentPlayers`, `activeId`), `classifyOverlap`, `classifyGameOverlap`, `refProvenance`, and `instanceUsage` (editor display). Also used by the player-stats modal — see [player-stats.md](player-stats.md).
- `GameshowEditor` receives `activeGameshow` (the "now" divider) alongside `allGameshows`.

## UI behaviour

- Component affected: `src/components/backend/GameshowEditor.tsx`
- Players combobox sits between the gameshow name/ID line and the game order list
- Planning overview is hidden by default; toggled by the **▼ / ▲ Planung** button
- Adding a game via the planning overview appends it to `gameOrder`

## Out of scope

- Explicit gameshow **dates** or drag-reordering of gameshows — the timeline is config insertion order; the operator arranges shows oldest → newest.
- Automatically removing or blocking already-played games from the game order.
