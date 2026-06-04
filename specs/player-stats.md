# Spec: Player Stats

## Goal

In the admin **gameshows** tab, clicking a player chip opens a modal that shows which games that player has already played — derived from the manually-maintained `_players` data on game files — so the operator can see a participant's history at a glance.

## Acceptance criteria

- [ ] Each player chip in a gameshow card's **Spieler** combobox (`PlayersCombobox`) is clickable; clicking the player's name opens the player-stats modal. The chip's `×` remove button keeps its existing behaviour and does **not** open the modal.
- [ ] The modal shows, for the clicked player, every game **instance** in which that player appears in any past `_players` session, aggregated across **all** game files (not scoped to the current gameshow).
- [ ] The modal header shows the player name and a close button.
- [ ] A summary line states how many instances the player has played, across how many distinct games, and how many gameshows the player participates in (e.g. `7 gespielte Spiele in 5 verschiedenen Spielen · 3 Gameshows`). The gameshow count is the number of gameshows whose participant list includes the player (independent of whether games were played); it is omitted when zero.
- [ ] A **breakdown by game type** lists each game type the player has played with a count, sorted by count descending, using the German label from `GAME_TYPE_INFO`.
- [ ] The played games are **grouped by the gameshow the player was in**: one group per gameshow whose participant list includes the player AND whose `gameOrder` contains the played instance. Played instances not covered by any such gameshow appear in a trailing **Andere Spiele** group. Groups follow `config.gameshows` insertion order; empty groups are omitted.
- [ ] Each group shows one row per played instance: game title, instance key, game-type label, and the matching past session(s) with the player's name highlighted.
- [ ] **Collapsible groups:** each group has a chevron toggle and an entry-count badge; clicking the chevron collapses/expands that group's list. Groups start expanded. Toggling collapse does not trigger the gameshow link.
- [ ] **Linking:** clicking a gameshow group heading focuses that gameshow's card in the Gameshows tab (expands + scrolls to it). Clicking a game row opens that game/instance in the **Spiele** tab (via the `#games/<file>/<instance>` hash deep-link). The "Andere Spiele" heading is not a link.
- [ ] **Type filter:** clicking a breakdown row filters the grouped list to that game type; clicking the same row again clears the filter; clicking a different row switches the filter. The active row is visually highlighted and a "Filter aufheben" affordance is shown. The breakdown counts stay at their full (unfiltered) totals so the user can always switch/clear.
- [ ] When the player appears in no `_players` session, the modal shows an empty state: `Noch keine gespielten Spiele für {player}.`
- [ ] The modal closes on `Escape`, on overlay click, and via the close button. Following a link also closes the modal.
- [ ] The modal and its contents are responsive at 375 / 768 / 1024 / 1920 px.
- [ ] A representative example is added to the admin Theme Showcase (`/theme-showcase`).

## Matching rule

A player "played" an instance when their name matches a token of any `_players` session string for that instance. Sessions are comma-separated lists of player abbreviations (e.g. `"St, Ju, Th"`). Comparison is **case-insensitive** and tokens/names are **trimmed** before matching — identical to `computeOverlap` in `GameshowEditor.tsx`.

## State / data changes

- **No** new app state, no new API endpoints, no contract changes.
- Purely client-side: reuses the existing `GameFileSummary[]` already fetched by `GameshowEditor` via `fetchGames()` (`GET /api/backend/games`), specifically the `type`, `title`, `fileName`, `instances`, and `instancePlayers?: Record<string, string[]>` fields.
- The grouping also reads the gameshows config: `GameshowsTab` passes `config.gameshows` (`Record<string, GameshowConfig>`) down through `GameshowEditor` to the modal. Each `GameshowConfig` contributes its `players` (participant match) and `gameOrder` (lineup membership).
- New pure helper `computePlayerHistory(player, games, gameshows)` in `src/utils/playerStats.ts` (returns `entries`, `byType`, and `groups`).
- New component `src/components/backend/PlayerStatsModal.tsx`.

## UI behaviour

- Component affected: `src/components/backend/GameshowsTab.tsx` (passes `allGameshows` + `onNavigateToGameshow` and exposes `focusGameshow`), `src/components/backend/GameshowEditor.tsx` (clickable chips + modal mount + `gs-card-<id>` anchor for scroll), `src/components/backend/PlayerStatsModal.tsx` (new).
- Modal styling mirrors `ConfirmModal` (`.modal-overlay` + a `.player-stats-box` variant) and reuses `.planning-session` / `.session-player.matched` for the session rows.
- **Navigation:** game links set `window.location.hash = 'games/<file>/<instance>'`, which `AdminScreen`'s existing `hashchange` listener (`syncFromHash`) turns into a Spiele-tab open. Gameshow links call `onNavigateToGameshow(id)` → `GameshowsTab.focusGameshow(id)`, which expands the card and `scrollIntoView`s `#gs-card-<id>`. No new routes/contracts.

## Out of scope

- **Single-instance games.** The server only collects `instancePlayers` for multi-instance games (`server/index.ts`), so single-instance games carry no `_players` and never appear in a player's history. This matches the existing planning overview, which always renders single-instance games as `Neu`. Reading a top-level `_players` for single-instance games is not part of this feature.
- Per-player scoring, win rates, points, or MVP tracking — none of that data exists; this feature surfaces only the `_players` "already played" history.
- Clicking player names anywhere else (live games, gamemaster, summary screen).
- Automatically writing back to `_players` when a gameshow is played (remains a manual edit, per [game-planning.md](game-planning.md)).
