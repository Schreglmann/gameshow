# Spec: Player Stats

## Goal

In the admin **Gameshows** tab, clicking a player chip opens a modal that shows which gameshows that player has been part of and the games in each — so the operator can see a participant's history (and upcoming/planned games) at a glance. The data is **derived from gameshow membership**, not from any per-game field.

## Model

A player "played" every game in the `gameOrder` of any gameshow whose `players` list includes them. The **active gameshow** (`config.activeGameshow`) is the "now" divider (`referenceIndex` = its config index): gameshows **before** it have happened (played), the active one and **later** ones are upcoming ("Eingeplant").

## Acceptance criteria

- [x] Each player chip in a gameshow card's **Spieler** combobox (`PlayersCombobox`) is clickable; clicking the name opens the player-stats modal. The chip's `×` remove button keeps its behaviour and does not open the modal.
- [x] The modal shows every gameshow whose participant list includes the player, aggregated across **all** gameshows (not scoped to the current one), each listing that gameshow's full lineup.
- [x] The modal header shows the player name and a close button.
- [x] A summary line states how many games the player has already played, across how many distinct games, and how many gameshows they participate in (e.g. `4 gespielte Spiele in 3 verschiedenen Spielen · 2 Gameshows`), plus a `· N eingeplant` suffix when future games exist.
- [x] A **breakdown by game type** lists each game type among the **played** games with a count, sorted by count descending, using the German label from `GAME_TYPE_INFO`.
- [x] Games are **grouped by gameshow** (config insertion order). Groups at or after the active gameshow are marked **Eingeplant** with a purple badge; earlier groups are already played.
- [x] Each group shows one row per game in the lineup: game title, instance key (if any), and the game-type label.
- [x] **Collapsible groups:** each group has a chevron toggle and an entry-count badge; groups start expanded. Toggling collapse does not trigger the gameshow link.
- [x] **Linking:** clicking a gameshow group heading focuses that gameshow's card in the Gameshows tab (expand + scroll). Clicking a game row opens that game/instance in the **Spiele** tab (`#games/<file>` or `#games/<file>/<instance>` hash deep-link).
- [x] **Type filter:** clicking a breakdown row filters the grouped list to that game type; clicking again clears it. The breakdown counts stay at their full (played) totals.
- [x] When the player is in no gameshow, the modal shows: `Noch keine Gameshow mit {player}.`
- [x] The modal closes on `Escape`, overlay click, and the close button; following a link also closes it.
- [x] Responsive at 375 / 768 / 1024 / 1920 px; a representative example is in the admin Theme Showcase.

## State / data changes

- **No** new app state, no new API endpoints, no contract changes. Purely client-side.
- Reuses the `GameFileSummary[]` fetched by `GameshowEditor` (`GET /api/backend/games`) only to resolve each ref's `title`/`type`; the played/planned data comes from `config.gameshows` (`Record<string, GameshowConfig>`) passed down from `GameshowsTab`.
- `computePlayerHistory(player, games, gameshows, referenceIndex?)` in `src/utils/playerStats.ts` returns `{ playedCount, plannedCount, gameCount, gameshowCount, byType, groups }`.
- Component: `src/components/backend/PlayerStatsModal.tsx`.

## Out of scope

- Per-player scoring, win rates, points, or MVP tracking — none of that data exists.
- Clicking player names anywhere else (live games, gamemaster, summary screen).
