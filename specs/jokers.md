# Spec: Jokers

## Goal
Give each team a set of single-use jokers they can spend during a gameshow; admin selects which jokers are available per gameshow; the gamemaster (GM) resolves effects manually — the app only tracks "used" state.

## Acceptance criteria
- [ ] Joker catalog is hardcoded in [src/data/jokers.ts](../src/data/jokers.ts) as `JOKER_CATALOG: readonly JokerDef[]` (entries: `{ id, name, description }`, no emoji field); no admin CRUD, no JSON file.
- [ ] Each catalog entry has a matching SVG icon registered in [src/components/common/JokerIcon.tsx](../src/components/common/JokerIcon.tsx); a unit test fails the build if any catalog id lacks an icon.
- [ ] Icons are stroke-based inline SVGs using `currentColor`, so they inherit the active theme's text color; per-theme icon overrides are supported via `THEME_ICONS` in the same file.
- [ ] `GameshowConfig.enabledJokers: string[]` selects a subset of catalog IDs per gameshow.
- [ ] Admin "Verfügbare Joker" selector in the gameshow editor renders one styled toggle card per catalog entry — click a card to toggle it on/off (no checkboxes); active cards show a highlighted border + accent-coloured icon; inactive cards are dimmed.
- [ ] Joker icons render inline inside the `Header` — team1's icons sit next to the Team 1 points label; team2's next to the Team 2 points label. No fixed/floating bar.
- [ ] Each row shows one SVG icon per enabled joker, rendered via `<JokerIcon id={...} />` inside a `<TeamJokers team={...} />` component.
- [ ] Clicking a joker toggles its used state: available → used, used → available. Both transitions emit a `use-joker` gamemaster command so both tabs stay in sync.
- [ ] Used jokers are rendered greyscale + strike-through but remain clickable (so an accidental click can be undone).
- [ ] When `currentIndex === totalGames - 1`, unused jokers are locked (cannot be activated). Already-used jokers can still be reverted to available so mistakes aren't permanent.
- [ ] Hovering/focusing a joker icon reveals a tooltip with the joker's name and description.
- [ ] The `GamemasterScreen` has a per-team Joker section with a toggle per enabled joker; the GM can override used/unused state at any time.
- [ ] Joker state is persisted to localStorage (`team1JokersUsed`, `team2JokersUsed`) and syncs between tabs via the storage event.
- [ ] `RESET_POINTS` also clears both joker arrays (single-run lifecycle).
- [ ] `validate-config.ts` emits an `invalid-joker-id` diagnostic when `enabledJokers` references an ID not in the catalog.
- [ ] Theme showcase has a JokerBar preview with available, used, and last-game-locked states.

## State / data changes
- New file [src/types/jokers.ts](../src/types/jokers.ts): `JokerDef { id; name; description }`, `JokerTeam`.
- New file [src/data/jokers.ts](../src/data/jokers.ts): exports `JOKER_CATALOG`, `JokerId` union type, `getJoker(id)`.
- New file [src/components/common/JokerIcon.tsx](../src/components/common/JokerIcon.tsx): exports `<JokerIcon id={} theme={} size={} />` (stroke-based inline SVGs, theme-aware via `THEME_ICONS`) and `hasJokerIcon(id)` (used by the catalog test).
- `GameshowConfig.enabledJokers?: string[]` (new optional field in [src/types/config.ts](../src/types/config.ts)).
- `SettingsResponse.enabledJokers: string[]` — derived from active gameshow's config on the server.
- `TeamState.team1JokersUsed: string[]`, `TeamState.team2JokersUsed: string[]`.
- `GlobalSettings.enabledJokers: string[]`.
- New reducer actions: `USE_JOKER`, `SET_JOKER_USED`, `RESET_JOKERS`, `SET_JOKERS_STATE`.
- `RESET_POINTS` extended to clear joker arrays.
- `GamemasterCommand` controlId `use-joker` with value `{ team, jokerId, used: 'true' | 'false' }`.
- localStorage keys: `team1JokersUsed`, `team2JokersUsed` (JSON-encoded string arrays).

## UI behaviour
- `TeamJokers` — compact grid rendered inside each team's header cell, separated from the points label by a subtle vertical divider so the jokers still read as "part of" that team. Grid is count-adaptive, capped at 3 columns × 2 rows (max 6): 1→1×1, 2→2×1, 3→3×1, 4→2×2, 5→3×2 (one empty slot), 6→3×2 full. Icons are clamp(32px, 2.2vw, 40px) square buttons with a subtle glass plate; SVG inside is 24px via `<JokerIcon size={24}>`. Team 1 icons render right of the points label; Team 2 icons left of its label.
- **Responsive:** icons shrink to ~30px below 1024px. Below 768px the team pill switches to a vertical stack — points label on top, joker strip directly below, separated by a horizontal divider. On this breakpoint the joker strip is a single-row flex container where icons share the cell width equally (`flex: 1 1 0; aspect-ratio: 1; min-width: 20px; max-width: 40px`), so 6 active jokers squeeze together while fewer active jokers hit the 40px cap and render larger. Team cells get `min-width: 0` so they can shrink below their intrinsic content width on phones; below 480px the icon `min-width` drops to 14px so all 6 still fit at 375px viewport. `#gameNumber` keeps `white-space: nowrap` so "Spiel N von M" never wraps into a multi-line pill.
- States: available (full color, clickable, `aria-pressed="false"`) / used (greyscale + strike-through, still clickable to revert, `aria-pressed="true"`) / last-game-locked (only applies to *unused* jokers during the last game, ~0.4 opacity, `aria-disabled="true"`, tooltip appends "(im letzten Spiel gesperrt)"). `isLastGame` is derived from `state.currentGame`; when `currentGame` is null (e.g. home/summary screens), nothing is locked.
- Tooltip: CSS `::after` on hover/focus showing `name — description`, positioned BELOW the icon (since the header sits at the top of the viewport). Team 1 tooltips anchor to the left edge of the icon, Team 2 tooltips to the right, so tooltips never overflow the viewport edges.
- Admin: "Verfügbare Joker" styled toggle cards inside [GameshowEditor.tsx](../src/components/backend/GameshowEditor.tsx) — one button-card per catalog entry (SVG icon + name + description). No checkboxes. Click to toggle on/off; active cards get an accent border + highlighted icon, inactive cards are dimmed. Saved via existing `PUT /api/backend/config` autosave flow.
- Gamemaster: new Joker section on `/gamemaster`, only rendered when a frontend is currently broadcasting gamemaster-answer data — hidden while the GM waiting screen ("Gamemaster-Ansicht") is shown. **Collapsed by default** — the header renders as a button showing "Joker" + a `used / total` counter + chevron; click to expand. When expanded, two sub-cards (Team 1 / Team 2) appear with a toggle switch per enabled joker. GM toggles fire `use-joker` commands. An "Im letzten Spiel erlauben" override checkbox bypasses the last-game lock.

## Out of scope
- Automatic enforcement of joker effects (sit-outs, solo answers, double-answer scoring, AI integration).
- `countPerTeam` or multi-use jokers.
- Undo history beyond the GM's toggle.
- CRUD of catalog entries from admin — adding a joker is a code change via the `add-joker` skill.
