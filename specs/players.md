# Spec: Players (registry, unique players, nicknames in the show)

## Goal
Every player has a nickname (Spitzname) and, ideally, a first name and a surname, and exists exactly
once. The show and the gamemaster call a player by their nickname, and add as much of the surname as
it takes to tell players with the same nickname apart. Players added during the show land in the
registry and in the active gameshow, so the admin stays in sync with the room.

## Acceptance criteria

### Registry
- [x] `config.json` holds one global player registry: `AppConfig.players: Player[]`, where
      `Player = { id, firstName, lastName, nickname }`. The nickname is required (the admin forms
      fill an empty one with the first name); first name and surname may be empty — a player added
      during the show has only the nickname until someone completes the name in the admin.
- [x] A player is unique: no two registry entries share the same full name (first + last, trimmed,
      whitespace collapsed, case-insensitive), no two players without a first name and surname share
      a nickname, and no two share an id.
- [x] The id is a slug of the full name (of the nickname for a player without one) made when the
      player is created (`anna-mueller`; `-2`, `-3` on a collision —
      [src/utils/playerRegistry.ts](../src/utils/playerRegistry.ts)). It never changes, not even when
      the player is renamed, so gameshows and stats keep pointing at the same person.
- [x] **Disabled players** (`Player.disabled: true`; absent = active) are switched off globally: they
      stay in every gameshow they are in (chips, draw, stats, "Bereits gespielt von", planning), but no
      autocomplete offers them — not the gameshow combobox in the admin, not the show's or the GM's add
      fields — **unless the typed text is one of their names in full** (first name, surname, nickname,
      full name or admin label, case-insensitive, after trimming). A typed name still resolves to them
      (see "Typed names"); a nickname an active and a disabled player share resolves to the active one.
- [x] `GameshowConfig.players` is a list of registry **ids**. Renaming a registry player therefore
      renames them in every gameshow and in the player stats.
- [x] `GET /api/settings` returns the active gameshow's players resolved to `Player` objects
      (`players`; unknown ids are skipped and logged, duplicates removed) and the whole registry
      (`registry`) for the show's and the gamemaster's autocomplete.
- [x] `npm run validate` rejects: a registry that is not an array, entries that are not objects, ids
      that are not slugs, duplicate ids, a blank nickname, a first name or surname that is not a
      string, a `disabled` that is not a boolean, duplicate full names, two name-less players with the same nickname, gameshow `players`
      entries that are not registry ids (a legacy name string gets a hint to run the migration), and an
      id listed twice in one gameshow. Leading/trailing whitespace in a name is a warning.

### Display rule
- [x] Show and gamemaster show a player by **nickname** only, unless another player in the same
      set has the same nickname (case-insensitive). Then the **shortest unique prefix** of the
      surname is added — usually its first letter — with a dot when it is shortened (nicknames in the
      examples: Michi, Jo, Anna):
  - Michi (Michael Huber) + Michi (Michaela Pichler) → "Michi H." / "Michi P."
  - Jo (Johannes Kaiser) + Jo (Johanna Koller) → "Jo Ka." / "Jo Ko."
  - Anna Huber + Anna Huberty → "Anna Huber" / "Anna Hubert." (the whole surname needs no dot)
  - Two players with the same nickname AND surname are told apart by first name: "Michi (Michael)" /
    "Michi (Michaela)".
  - A player with no surname shows the nickname; "Anna" next to "Anna Müller" is "Anna" / "Anna M."
  - A player without a nickname (rosters from before nicknames) is shown by first name.
  - Code points count as one letter ("Ö", not a broken byte), a prefix never ends at a space
    ("van B." not "van "), and a surname prefix that already ends in "." gets no second dot.
- [x] The set is **every player in the live draw** (all active teams), not one team — a player keeps
      the same label when moved to another team.
- [x] The label is derived at read time ([src/utils/playerNames.ts](../src/utils/playerNames.ts)
      `displayNames` / `rosterDisplayNames`, hook
      [useRosterDisplayNames](../src/hooks/useRosterDisplayNames.ts)) and never stored.
- [x] It is used on every show and GM surface that prints a player: the hidden-draw grid, the team
      cards, the GM draw preview and member lists, the summary's winner grid, the Quizjagd turn line,
      the bet-quiz and wer-kennt-mehr member lines and GM sub-labels, and the GM correct-answer
      tracker.
- [x] The GM's move/remove popover on a drawn player (random mode) is headed by the player's admin
      label (`Michael „Michi“ Huber`, `GamemasterButtonDef.menuTitle`), while the button keeps the
      short show label.
- [x] The admin always shows **full names**, with the nickname when it differs from the first name:
      `Michael „Michi“ Huber` (registry, combobox chips, stats); a player with neither first name nor
      surname shows the nickname. The Session tab's member fields list first name + surname (the
      nickname for a player without them).

### Live rosters
- [x] A roster entry is `RosterPlayer = { firstName, lastName, nickname?, id? }`. Registry players
      carry their id and nickname; a typed new player is `{ firstName: '', lastName: '', nickname }`
      until the registry gives them an id.
- [x] Two entries are the same player when both have an id and the ids match, otherwise when their
      full names match (case-insensitive) — for players without first name and surname, when their
      nicknames match.
- [x] **Autocomplete.** The show's add field, the manual-mode "+ Spieler hinzufügen" slot of each team
      card, and the GM's "Spieler hinzufügen" fields (random and manual mode) suggest registry players
      while typing: every registry player not yet in the draw whose first name, surname or nickname
      contains the text (a disabled player only on a full name, see "Disabled players"), listed with
      the admin label (`Michael „Michi“ Huber`), at most 8. Arrow keys
      move, Escape closes. **ArrowDown in a field without an open list — or a click / tap into the field while it already
      has the focus (not the click that focuses it) — shows the whole list** —
      every candidate except disabled players, alphabetical, scrollable, first entry highlighted;
      typing goes back to filtering. Enter on the highlighted entry, or a tap, only **fills in** its label (in
      place of the name being typed, after any earlier comma-separated names) and closes the list; the
      **next** Enter (or "Hinzufügen", or leaving a team-card slot) adds it. The label resolves to that
      registry player (see "Typed names"), who joins with their registry id and is shown by nickname
      like everyone else. Enter without a highlighted suggestion adds the typed text. The GM gets the
      candidates with the control (`GamemasterInputDef.suggestions`), fills them in locally and
      submits the text like any typed name — there is no separate pick command. The GM's add fields
      empty themselves after a submit (`clearOnSubmit`), like the show's.
- [x] **Typed names** (comma-separated for several) are resolved against the registry: a text that is
      a registry player's full name or admin label, or the nickname of exactly one registry player
      (active players first: when exactly one active player has it, that one), adds that player.
      A nickname several registry players share is refused with "„Michi“ gibt es mehrmals – bitte aus
      der Liste auswählen." Anything else is a new player, added **as written** as the nickname —
      no splitting into first name and surname, no capitalizing. The admin Session tab parses the same
      way.
- [x] Every player in a draw is unique. Adding a player who is already in it is refused with
      "„Anna Müller“ ist schon dabei." (several: "Schon dabei: …"). Adding a surname-less player
      whose name is already shown for someone else is allowed but shows "„Anna“ gibt es schon – Vor-
      und Nachnamen im Admin ergänzen, damit sie unterscheidbar sind." The feedback appears under the
      show's add field (hidden with the show buttons) and as an info line in the GM controls.
- [x] **Sync to the gameshow.** Every add and remove on the show or the GM (add field, autocomplete,
      team-card slots, ✕ in the hidden draw, GM "Entfernen", clearing a team-card input, replacing a
      name in one) is written to the active gameshow's `players` through `POST /api/live-players`: an
      added registry player's id is appended; a new name becomes a registry player with only the
      nickname (first name and surname empty, to be completed in the admin) and is appended; a removed
      player's id is taken out of the gameshow, and out of the registry too when that was their last
      gameshow (see "Removed from every gameshow"). Moves between teams and
      reshuffles change nothing. Only the active show tab writes. A failed write (encrypted or missing
      config) leaves the live draw as it is. The settings reload that follows gives the new player
      their registry id in the roster (`applyPlayerRenames`), so their stats count.
- [x] Manual-mode / revealed team-card inputs show the label while not focused and the **full name**
      while focused. On blur the edited player is found by identity, not position; if the full name
      did not change (case aside) the player keeps their id; a name that duplicates another player
      reverts the field and shows the feedback.
- [x] When the configured players change at runtime (admin, live reload) the draw follows by id:
      removed ids drop out, new ids join the smallest team, renamed players are updated in place —
      also after the reveal. Only the active show tab writes this.
- [x] Rosters from before this change (plain name strings in localStorage or in the server's cached
      team state) are converted on read — first word to first name, the rest to surname, no id — and
      never dropped.

### Admin
- [x] Opening the **Spieler** tab puts the cursor in its search field.
- [x] A **Spieler** tab lists the registry as a **read-only list of whole names** — `Michael „Michi“ Huber`,
      the nickname only when it differs from the first name; a player without first name and surname
      shows the nickname and "Name fehlt" — sorted by first name (nickname when there is none), in columns that
      fill top to bottom on wide screens, each with the number of gameshows the player is in (hover
      lists them) and ✕ to delete. Search matches any of the three names. There are no inputs in the
      list (a browser's contact autofill used to paint over the name inputs).
- [x] A name opens the **player lightbox** ([PlayerLightbox](../src/components/backend/PlayerLightbox.tsx)) over the
      open tab: the admin label as heading with ✕, the three name fields and "Löschen", and the
      player's statistics below ([player-stats.md](player-stats.md)) — names and statistics in one
      place. The name fields **save as you type**, like every other admin field (shared save queue,
      no save button); an empty nickname = the first name, shown as an empty field when it equals the
      first name. A name the registry can't take — neither first name nor nickname, or a duplicate —
      shows "Vorname oder Spitzname angeben." / "„Anna Müller“ gibt es schon." and is not saved until
      it is fixed. An **"Aktiv"** switch under the names disables or enables the player (saved at
      once); the Spieler list marks a disabled player "Deaktiviert" and dims them. ✕, Escape or a
      click outside close it (Escape in the delete confirmation only
      closes the confirmation); a gameshow or game link in the stats closes it and switches tab. An
      unknown id shows "Diesen Spieler gibt es nicht (mehr)."
- [x] **Every clickable player name in the admin opens that lightbox, without leaving the tab**
      (`openPlayer` in [openPlayer.ts](../src/components/backend/openPlayer.ts), a window event the one
      `PlayerLightboxHost` in AdminScreen listens to): the Spieler list, the gameshow combobox chips,
      "Bereits gespielt von" in the game editor and the planning provenance lines. The lightbox reads
      and saves the config itself through the shared save queue.
- [x] "+ Spieler" opens a popup ([PlayerEditDialog](../src/components/backend/PlayerEditDialog.tsx)) with
      first name, surname and nickname to create a player (a first name or a nickname is required); errors keep it open, "Abbrechen", Escape
      or a click outside close it without saving. Deleting a player who is in a gameshow asks first
      and removes them from those gameshows too.
- [x] The gameshow's player combobox selects registry players (matched on full name or nickname;
      disabled players only on a name typed in full). A
      name that is not in the registry offers "„…“ neu anlegen", which opens a first name / surname /
      nickname form
      prefilled by splitting at the first space; the new player is added to the registry and to the
      gameshow in one step. A player already in the gameshow is not offered again.
- [x] **Removed from every gameshow → removed from the registry.** When a player is taken out of a
      gameshow — a combobox chip's ×, Backspace in the combobox, or a remove on the show / GM — and
      is then in no gameshow any more, they are deleted from the registry (and the Spieler tab) in
      the same write ([`dropOrphanedPlayers`](../src/utils/playerRegistry.ts)). Only a removal
      prunes: a player created in the Spieler tab and not yet in any gameshow stays, and deleting a
      whole gameshow leaves its players in the registry. A player still in another gameshow stays.
- [x] **Player bin.** Every player who leaves the registry — taken out of their last gameshow, ✕ in the
      Spieler tab, "Löschen" in the lightbox — lands in a local bin, `players-bin.json` next to
      config.json (**gitignored**; it holds personal names), as they were: id, names, `disabled`. The
      server writes it on every config write that changes the registry (admin
      `PUT /api/backend/config` and `POST /api/live-players`), before the config itself
      ([server/player-bin.ts](../server/player-bin.ts), rules in
      [src/utils/playerBin.ts](../src/utils/playerBin.ts)).
- [x] A binned player is **suggested again only for one of their names typed in full** (like a
      disabled player) — in the admin gameshow combobox (marked "· aus dem Papierkorb"), on the show and
      on the GM (`SettingsResponse.binned`). A typed name resolves to them too (an active player wins a
      shared nickname). Adding them **restores them to config.json** with their old id, names and flag,
      into that gameshow, and takes them out of the bin. A live add of a name that matches a binned
      player's identity restores that player instead of creating a new one, and a new player's id never
      reuses a binned player's id.
- [x] Player stats, game-planning overlap and "Bereits gespielt von" are keyed by id.

### Sync and migration
- [x] The team-state WS channel is `gamemaster-team-state-v3` (was `-v2`): a show, gamemaster or
      admin tab still running the old code stops syncing instead of crashing on object rosters or
      writing `[object Object]` back. **After deploying, reload every open tab.**
- [x] `scripts/migrate-players.ts` turns the old name strings into the registry from a mapping file
      the operator writes (`{ players: [{ firstName, lastName, aliases: [...] }] }`, kept outside the
      repo). The aliases are the old name strings, and the **first alias is the nickname** — minus a
      trailing surname initial the old names used to tell people apart ("Michi H." → "Michi"; the
      display rule adds the letter back when it is needed). `--template` prints a skeleton with every
      current name; without `--write` it is a dry run. It refuses to write unless every old name is in exactly one alias list, both names are
      filled and full names are unique; it reuses existing registry ids, so a second run changes
      nothing.

## State / data changes
- `AppConfig.players?: Player[]`; `GameshowConfig.players?: string[]` (ids).
- `SettingsResponse.players` / `GlobalSettings.players`: `Player[]`; `SettingsResponse.registry` /
  `GlobalSettings.registry`: the whole registry.
- `Player.disabled?: true`.
- `GamemasterInputDef.suggestions?: { id, label, fullMatch? }[]` (`fullMatch`: a disabled player's
  names — offered only when the typed text is one of them) (the GM fills a pick in and submits it as text).
- `SettingsResponse.binned` / `GlobalSettings.binned`: the bin. `GET /api/backend/player-bin` →
  `{ players: Player[] }`. Local file `players-bin.json` `{ players: Player[] }` (gitignored).
- `POST /api/live-players` `{ add?: ({ id } | { firstName?, lastName?, nickname })[], remove?: id[] }`
  → `{ players: Player[] }` (the added players, as stored).
- `TeamState.team1..team4`: `RosterPlayer[]` (localStorage keys unchanged; legacy strings converted
  on read).
- WS channel `gamemaster-team-state-v2` → `gamemaster-team-state-v3`.

## Example players
A fresh clone's default config and "Beispiele erstellen" / `npm run fixtures` seed nine made-up
players into an empty registry (see [example-games.md](example-games.md)). The e2e helpers answer
`POST /api/live-players` themselves (`blockLivePlayerSync`), so an e2e run against a local dev server
never writes its test players into the real config.

## Out of scope
- Stats for a live-added player before the registry write landed (they have no id yet), or when it
  failed.
- Syncing roster edits made in the admin Session tab back to the gameshow.
- Merging two registry players in the admin (fix the config or delete one).
