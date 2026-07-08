# Spec: gameOrder cascade on game / instance deletion + single→multi conversion

## Goal
When a game file or a single instance of a multi-instance game is deleted via the admin
backend, automatically remove every `gameOrder` reference to it from **all** gameshows in
`config.json`, so a deleted game can never leave a dangling reference that breaks the show.
The same cascade machinery also **rewrites** (rather than drops) bare refs when a
single-instance game is converted to multi-instance.

## Background
`config.json` references games positionally: `gameshows[key].gameOrder` is a `string[]` of
refs like `"trump-oder-hitler"` (single-instance) or `"allgemeinwissen/v1"`
(`<gameName>/<instanceKey>`, multi-instance). At runtime the server resolves
`gameOrder[index]` → `games/<gameName>.json`. A ref that no longer resolves makes
`GET /api/game/:index` 404 and `npm run validate` fail — the show is "broken".

Renaming a **game file** already rewrites `gameOrder` (`POST /api/backend/games/:fileName/rename`).
Deletion did not: it left orphaned refs behind. This spec closes that gap for deletions.

## Acceptance criteria
- [ ] Deleting a game file (`DELETE /api/backend/games/:fileName`) removes every `gameOrder`
      entry whose `gameName` equals `fileName`, across every gameshow — both bare
      (`fileName`) and instance-qualified (`fileName/v1`, `fileName/v2`, …) refs.
- [ ] Deleting a single instance (`DELETE /api/backend/games/:fileName/instances/:instance`)
      removes the instance from the game file **and** removes every `gameOrder` entry equal
      to `fileName/instance`, across every gameshow. Other instances of the same game and
      their refs are left intact.
- [ ] Both endpoints return `{ success: true, removedRefs: { gameshow, ref }[] }` so the
      admin can report how many references were cleaned up.
- [ ] Converting a single-instance game to multi-instance
      (`POST /api/backend/games/:fileName/convert-to-multi`) re-points every **bare** ref
      `fileName` to `fileName/v1` across every gameshow (existing content becomes instance
      `v1`). Already-qualified refs and refs to other games are left untouched. Returns
      `{ success, gameFile, rewrittenRefs: { gameshow, ref }[], alreadyMulti? }`; idempotent
      (no-op with `alreadyMulti: true` when the file already has instances).
- [ ] The cascade is **best-effort and config-safe**: if `config.json` is missing,
      git-crypt-encrypted, or unparseable, it is left untouched (we never overwrite an
      encrypted config with plaintext) — the deletion still succeeds.
- [ ] `config.json` is written atomically (tmp file + rename), preserving its existing
      indentation, exactly like the rename and config-save endpoints.
- [ ] After a cascade, `npm run validate` passes (no orphaned `gameOrder` refs remain for
      the deleted game/instance).

## State / data changes
- No `AppState` / client-state changes.
- New endpoint: `DELETE /api/backend/games/:fileName/instances/:instance` → `{ success, removedRefs }`.
- Changed response of `DELETE /api/backend/games/:fileName`: now `{ success, removedRefs }`
  (previously `{ success: true }`). It no longer rejects when the game is referenced — it
  cascades instead.
- New pure helper module `server/game-order.ts` (`pruneGameOrder(config, shouldDrop)` for
  deletion; `requalifyBareRefs(config, gameName, instance)` for single→multi conversion),
  unit-tested in isolation.
- New endpoint: `POST /api/backend/games/:fileName/convert-to-multi` → `{ success, gameFile,
  rewrittenRefs, alreadyMulti? }`. Rewrites the game file (content → instance `v1`) then
  cascades the bare-ref requalification.

## UI behaviour
- **Games tab** (`GamesTab.tsx`): deleting a game shows the existing confirm dialog, then a
  toast. When refs were removed, the toast also reports the count
  (`… aus N Gameshow(s) entfernt`).
- **Game editor** (`GameEditor.tsx`): deleting an instance flushes any pending auto-save
  first (so unsaved edits to other instances are not lost), calls the new instance-delete
  endpoint, then updates local state and switches to the next instance. A toast reports any
  removed refs.
- Deletion is **not** blocked by usage; the references are silently cleaned up and reported.
- **Game editor** (`GameEditor.tsx`): clicking **"+ Instanz"** on a single-instance game calls
  the convert endpoint, adopts the returned multi-instance file, appends an empty `v2`, and
  switches to it. A toast reports how many gameshow refs were re-pointed to `/v1`.

## Out of scope
- **Instance rename.** Renaming an instance (`v1` → `v2`) is a client-side key swap saved via
  `PUT`; it does not rewrite `gameOrder` and is a pre-existing gap. A `PUT` cannot tell a
  rename ("v1 gone, v2 appeared") from a delete ("v1 gone"), which is exactly why instance
  deletion uses a dedicated `DELETE` endpoint instead of `PUT` inference. Fixing rename is a
  separate task.
- Removing a ref that became orphaned by some other means (manual file deletion outside the
  app, etc.). `npm run validate` still reports those; this spec only cascades on the two
  delete endpoints.
- Pruning empty gameshows. A gameshow whose `gameOrder` becomes empty is left in place.
