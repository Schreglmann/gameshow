# Spec: Player Stats

## Goal

The **player lightbox** in the admin (see [players.md](players.md)) shows, below the player's names, which gameshows that player has been part of and the games in each — so the operator can see a participant's history (and upcoming/planned games) at a glance. The data is **derived from gameshow membership**, not from any per-game field.

## Model

A player "played" every game in the `gameOrder` of any gameshow whose `players` list includes their registry id (`computePlayerHistory(playerId, …)`). The **active gameshow** (`config.activeGameshow`) is the "now" divider (`referenceIndex` = its config index): gameshows **before** it have happened (played), the active one and **later** ones are upcoming ("Eingeplant").

## Acceptance criteria

- [x] Every clickable player name in the admin opens the player lightbox over the open tab, which holds the names and these stats in one place: the Spieler list, the chips of a gameshow's **Spieler** combobox (their `×` only removes), the "Bereits gespielt von" names in the game editor and the planning provenance names (`openPlayer` in [openPlayer.ts](../src/components/backend/openPlayer.ts)).
- [x] The stats show every gameshow whose participant list includes the player, aggregated across **all** gameshows (not scoped to the current one), each listing that gameshow's full lineup.
- [x] The stats sit in a "Statistik" section under the name fields; the lightbox heading is the player's admin label (`Michael „Michi“ Huber`).
- [x] A summary line states how many games the player has already played, across how many distinct games, and how many gameshows they participate in (e.g. `4 gespielte Spiele in 3 verschiedenen Spielen · 2 Gameshows`), plus a `· N eingeplant` suffix when future games exist.
- [x] A **breakdown by game type** lists each game type among the **played** games with a count, sorted by count descending, using the German label from `GAME_TYPE_INFO`.
- [x] Games are **grouped by gameshow** (config insertion order). Groups at or after the active gameshow are marked **Eingeplant** with a purple badge; earlier groups are already played.
- [x] Each group shows one row per game in the lineup: game title, instance key (if any), and the game-type label.
- [x] **Collapsible groups:** each group has a chevron toggle and an entry-count badge. Gameshows the player already played start **collapsed** (the list stays short); upcoming ("Eingeplant") ones start expanded. Toggling collapse does not trigger the gameshow link.
- [x] **Linking:** clicking a gameshow group heading focuses that gameshow's card in the Gameshows tab (expand + scroll). Clicking a game row opens that game/instance in the **Spiele** tab (`#games/<file>` or `#games/<file>/<instance>` hash deep-link).
- [x] **Type filter:** clicking a breakdown row filters the grouped list to that game type; clicking again clears it. The breakdown counts stay at their full (played) totals.
- [x] When the player is in no gameshow, the stats show: `Noch keine Gameshow mit {player}.`
- [x] ✕, Escape or a click outside close the lightbox; following a gameshow or game link closes it too.
- [x] Responsive at 375 / 768 / 1024 / 1920 px; a representative example is in the admin Theme Showcase.

## State / data changes

- **No** new app state, no new API endpoints, no contract changes. Purely client-side.
- The lightbox fetches `GameFileSummary[]` (`GET /api/backend/games`) only to resolve each ref's `title`/`type`; the played/planned data comes from `config.gameshows`.
- `computePlayerHistory(playerId, games, gameshows, referenceIndex?)` in `src/utils/playerStats.ts` returns `{ playedCount, plannedCount, gameCount, gameshowCount, byType, groups }`.
- Components: `src/components/backend/PlayerStats.tsx` inside `PlayerLightbox.tsx`.

## Out of scope

- Per-player scoring, win rates, points, or MVP tracking — none of that data exists.
- Clicking player names anywhere else (live games, gamemaster, summary screen).
