# Spec: Admin Gameshows tab

## Goal
Move gameshow management out of the admin **Config** tab into its own **Gameshows** tab, and make gameshow cards collapsible so a show with many gameshows stays scannable.

## Acceptance criteria
- [ ] A **Gameshows** tab appears in the admin sidebar between **Config** and **Spiele**.
- [ ] The Config tab no longer renders gameshows — only Themes, Global Settings, and Global Rules.
- [ ] The Gameshows tab lets you create (`+ Neue Gameshow`), rename, edit (players, planning, game order, jokers), activate, and delete gameshows — same functionality as before the split.
- [ ] Clicking a player chip's name in the **Spieler** combobox opens a player-stats modal (games-played history). See [player-stats.md](player-stats.md).
- [ ] Each gameshow card is collapsible via a disclosure chevron in its header. When collapsed, the header still shows the name, a game-count chip, the active badge / "Als aktiv setzen" button, and the delete button.
- [ ] The game-count chip (collapsed header) and the expanded-header meta line both show the **total number of questions** across all games in the gameshow next to the game count, e.g. `3 Spiele · 42 Fragen`. The total sums each referenced game/instance's question count (quizjagd buckets summed).
- [ ] The gameshow name is shown as plain text (not an always-on input). Clicking it swaps it for an input; Enter/Blur commits the rename, Escape cancels — the same inline click-to-edit pattern as DAM filenames.
- [ ] On page load (Gameshows tab mount), **only the active gameshow** is expanded; all others are collapsed.
- [ ] Activating a different gameshow while on the page does **not** change which cards are expanded: the previously-expanded card stays open and the newly-activated one is **not** auto-expanded.
- [ ] Creating a new gameshow opens it expanded.
- [ ] Renaming a gameshow keeps its expansion state across the id change.
- [ ] Edits autosave to `config.json` and survive a reload.

## State / data changes
- No new `AppState` / `config.json` fields. `GameshowConfig`, `activeGameshow`, `gameshows` unchanged.
- `GameFileSummary` (the `GET /api/backend/games` response item) gains `questionCount?` (single-instance) and `questionCounts?` (per-instance map) so the tab can sum totals without fetching every game file. OpenAPI updated accordingly.
- New shared hook `src/components/backend/useEditableConfig.ts` encapsulates config fetch / 800 ms debounced save / `content-changed` WS reconciliation / conflict banner, used by both `ConfigTab` and `GameshowsTab`.
- Expand state is **UI-only**, owned by `GameshowsTab` as a `Set<string>` of expanded gameshow ids; initialized once on first config load from `config.activeGameshow`. Not persisted.

## UI behaviour
- Components: new `GameshowsTab.tsx`; `ConfigTab.tsx` (gameshows removed); `GameshowEditor.tsx` (new `expanded` + `onToggleExpand` props, body wrapped); `AdminScreen.tsx` (new `'gameshows'` tab, nav entry + pane).
- Chevron mirrors the existing `gs-jokers-chevron` pattern (`▶` rotates 90° when open) — classes `gs-collapse-toggle` / `gs-collapse-chevron`.
- Name rename mirrors the DAM inline-rename pattern: a `.gs-name-text` span (hover affordance) that, on click, is replaced by an autofocused `.be-input`. `editingName` / `editName` are local `GameshowEditor` state; commit (Enter/Blur) calls `onRename(editName)`, Escape just exits edit mode. `renameGameshow` trims the input, no-ops on empty/unchanged, sets the name and re-derives the id atomically in one `setConfig`.
- Responsive at 375 / 768 / 1024 / 1920 px (header is flex; no fixed widths).

## Out of scope
- Persisting expand state across reloads or per-user.
- Adding a deep-link hash sub-route for an individual gameshow.
- Any change to gameshow data shape or the activation API.
