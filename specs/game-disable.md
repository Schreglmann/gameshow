# Spec: Disable a game (hide from the add-to-gameshow pickers)

## Goal
Let an operator mark a game — or a single instance of a multi-instance game — as
**disabled** so it no longer appears when adding games to a gameshow, while any
gameshow that already references it keeps working unchanged.

## Motivation
Over time some games turn out to be weak but are worth keeping around (they may
still be referenced by past gameshows, and might be revived later). Deleting them
would cascade-remove their `gameOrder` references and lose the content. Disabling
keeps the game intact and playable where it is already used, but takes it out of
the pool offered for new gameshows.

## Acceptance criteria
- [ ] A game file can be disabled via a toggle in the game editor's
      **Grundeinstellungen** card ("Spiel deaktiviert"). This sets `disabled: true`
      at the top level of the game file.
- [ ] A single instance of a multi-instance game can be disabled via a per-instance
      toggle in the instance card header ("Instanz deaktiviert"). This sets
      `disabled: true` inside that instance object.
- [ ] A disabled game (file-level) does **not** appear in either add-to-gameshow
      surface in `GameshowEditor`: the bottom "Spiel hinzufügen" picker **and** the
      "Planung" overview.
- [ ] A disabled **instance** does not appear as a selectable instance in those
      surfaces; its sibling (enabled) instances still do. When a multi-instance game
      is added via the bottom picker, the first **enabled** instance is chosen.
- [ ] A game already referenced in a gameshow's `gameOrder` still resolves and plays
      when disabled — `GET /api/game/:index` is unaffected (no runtime guard).
- [ ] An existing `gameOrder` row that references a disabled game/instance still
      displays its title correctly and can be reordered or removed. The game/instance
      dropdowns on that row keep offering the current selection even when disabled,
      but do not offer *other* disabled games/instances.
- [ ] An existing `gameOrder` row that references a disabled game/instance shows a
      small "Deaktiviert" marker so the operator can see it is still in use despite
      being disabled.
- [ ] The game stays visible (and editable) in the admin **Spiele** list regardless
      of its disabled state, so it can be re-enabled.
- [ ] `npm run validate` accepts `disabled` (boolean) at the game/instance level and
      rejects a non-boolean value.

## State / data changes
- `BaseGameConfig` gains `disabled?: boolean` (covers single-instance files and each
  instance object, since instances are `Partial<GameConfig>`).
- `MultiInstanceGameFile` gains `disabled?: boolean` (file-level, disables the whole
  multi-instance game).
- `GameFileSummary` (the `GET /api/backend/games` item) gains:
  - `disabled?: boolean` — file-level disabled (whole game).
  - `disabledInstances?: string[]` — instance keys (non-`template`) whose instance
    object has `disabled: true`. Multi-instance only.
- No `config.json` / `AppState` changes. Disabling is a property of the **game**, not
  of a gameshow.
- Not persisted to localStorage; lives only in the game file.

## Semantics (picker availability)
Let `g` be a `GameFileSummary` and `addedRefs` the set of refs already in this
gameshow's `gameOrder`.

- **Single-instance** `g` is offered iff `!g.disabled && !addedRefs.has(g.fileName)`.
- **Multi-instance** `g` is offered iff `!g.disabled` **and** it has at least one
  instance `inst` (non-`template`) with `!g.disabledInstances.includes(inst)` and
  `!addedRefs.has(\`${g.fileName}/${inst}\`)`.
- The "Planung" overview skips file-disabled games entirely and skips disabled
  instances.
- The existing-row game dropdown offers `availableGames.filter(g => !g.disabled)` plus
  the row's currently-selected game (even if disabled). The instance dropdown offers
  non-`template`, non-disabled instances plus the row's current instance.

Runtime resolution (`loadGameConfig` / `GET /api/game/:index`) ignores `disabled`
entirely.

## UI behaviour
- Components: `GameEditor.tsx` (file-level toggle in Grundeinstellungen; per-instance
  toggle in the instance card header next to lock/delete), `GameshowEditor.tsx`
  (picker filtering + "Deaktiviert" marker on referenced-but-disabled rows).
- Toggle reuses the existing `.be-toggle` switch styling. The "Deaktiviert" marker
  reuses badge styling (no new component).
- Responsive at 375 / 768 / 1024 / 1920 px (toggles sit in existing flex rows).

## Out of scope
- Bulk enable/disable from the Spiele list.
- Hiding/filtering disabled games *within* the Spiele list (they stay visible).
- Any warning when activating a gameshow that references a disabled game.
- A separate disabled state at the question level (already exists independently as
  `Question.disabled`).
