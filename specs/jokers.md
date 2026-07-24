# Spec: Jokers

## Goal
Give each team a set of jokers they can spend during a gameshow; admin selects which jokers are available per gameshow; the gamemaster (GM) resolves effects manually — the app only tracks "used" state. A global `jokerUsageScope` setting chooses whether a used joker stays used for the whole show (`per-gameshow`, default) or refreshes at the start of each game (`per-game`); the Aufholjoker (`comeback`) is always per-gameshow.

## Acceptance criteria
- [ ] Joker catalog is hardcoded in [src/data/jokers.ts](../src/data/jokers.ts) as `JOKER_CATALOG: readonly JokerDef[]` (entries: `{ id, name, description }`, no emoji field); no admin CRUD, no JSON file.
- [ ] Each catalog entry has a matching SVG icon registered in [src/components/common/JokerIcon.tsx](../src/components/common/JokerIcon.tsx); a unit test fails the build if any catalog id lacks an icon.
- [ ] Icons are stroke-based inline SVGs using `currentColor`, so they inherit the active theme's text color; per-theme icon overrides are supported via `THEME_ICONS` in the same file.
- [ ] `GameshowConfig.enabledJokers: string[]` selects a subset of catalog IDs per gameshow.
- [ ] Jokers are a per-team mechanic, so they are auto-disabled when the point system is off: `GET /api/settings` forces `enabledJokers: []` whenever `pointSystemEnabled` is `false`, regardless of the gameshow's configured set. This cascades to the `Header`, `GlobalRulesScreen`, and every game's joker UI (all read `state.settings.enabledJokers`). See [point-system.md](point-system.md).
- [ ] Admin "Verfügbare Joker" selector in the gameshow editor renders one styled toggle card per catalog entry — click a card to toggle it on/off (no checkboxes); active cards show a highlighted border + accent-coloured icon; inactive cards are dimmed.
- [ ] Joker icons render inline inside the `Header` — team1's icons sit next to the Team 1 points label; team2's next to the Team 2 points label. No fixed/floating bar.
- [ ] Each row shows one SVG icon per enabled joker, rendered via `<JokerIcon id={...} />` inside a `<TeamJokers team={...} />` component.
- [ ] Clicking a joker toggles its used state: available → used, used → available. Both transitions emit a `use-joker` gamemaster command so both tabs stay in sync.
- [ ] Used jokers are rendered greyscale + strike-through but remain clickable (so an accidental click can be undone).
- [ ] In the last game (`currentIndex === totalGames - 1`) the entire joker UI is hidden by default — `TeamJokers` renders nothing in the frontend header and the `.gm-jokers` section is not rendered on the gamemaster. When the global `jokersInLastGame` flag is enabled, jokers behave in the last game exactly like in any other game (no hiding, no locking).
- [ ] Hovering/focusing a joker icon reveals a tooltip with the joker's name and description.
- [ ] The global rules screen (`GlobalRulesScreen`) appends a generic, gameshow-agnostic joker explanation **only** when the active gameshow has at least one enabled joker. The text comes from `AppConfig.jokerRules` (operator-editable in the admin), delivered via `SettingsResponse.jokerRules`; when unset/empty the frontend falls back to the built-in `GENERIC_JOKER_RULES` default ([src/data/jokers.ts](../src/data/jokers.ts)). It never lists the specific enabled jokers (those surface as header tooltips). When there are configured `globalRules` above it, a divider (`.rules-joker-list--divided`) separates the two. When `globalRules` is empty but jokers are enabled, the rules screen still renders (shows only the joker block) instead of auto-forwarding; both the auto-forward and `GameScreen` first-game back-navigation gate on the shared `hasGlobalRulesContent()` helper ([src/utils/globalRules.ts](../src/utils/globalRules.ts)).
- [ ] The joker explanation text is edited in the admin **ConfigTab** ("Joker-Regeln" card, a `RulesEditor` writing `config.jokerRules`), prefilled with the `GENERIC_JOKER_RULES` default so the operator edits the current text rather than a blank list. `validate-config.ts` checks `jokerRules` is an array of strings.
- [ ] The `GamemasterScreen` has a per-team Joker section with a toggle per enabled joker; the GM can override used/unused state at any time.
- [ ] Joker state is persisted to localStorage (`team1JokersUsed`, `team2JokersUsed`) and syncs between tabs via the storage event.
- [ ] `RESET_POINTS` also clears both joker arrays (single-run lifecycle).
- [ ] `validate-config.ts` emits an `invalid-joker-id` diagnostic when `enabledJokers` references an ID not in the catalog.
- [ ] Theme showcase has a joker header preview with available and used states, plus a "last game without release — fully hidden" empty-state preview.
- [ ] Global `jokersInLastGame: boolean` flag (top-level `AppConfig`, default `false`) controls whether jokers stay available in the last game; toggled via an admin checkbox in "Globale Einstellungen".
- [ ] Global `jokerUsageScope: 'per-gameshow' | 'per-game'` (top-level `AppConfig`, default `'per-gameshow'`) selects the joker lifecycle: `per-gameshow` = each joker single-use for the whole show (cleared only on a full session reset); `per-game` = every joker EXCEPT the Aufholjoker (`comeback`) becomes available again at the start of each game. Set via a **toggle** ("Joker pro Spiel zurücksetzen", `title` tooltip on hover) in the admin ConfigTab "Globale Einstellungen" card — checked maps to `per-game`, unchecked to `per-gameshow`. `validate-config.ts` rejects any other value.
- [ ] In `per-game` mode, the `SET_CURRENT_GAME` reducer strips all non-`comeback` ids from both teams' `...JokersUsed` arrays when — and only when — the game **index** changes (a live gameOrder edit that changes only `totalGames` must not reset). The `comeback` used-mark and the armed `doubleNextGame` multiplier are preserved. The reset is deterministic so cross-tab (storage listener) and cross-device (WS `gamemaster-team-state`) copies converge. `per-gameshow` mode never resets on game change (behaviour unchanged).

## State / data changes
- New file [src/types/jokers.ts](../src/types/jokers.ts): `JokerDef { id; name; description }`, `JokerTeam`.
- New file [src/data/jokers.ts](../src/data/jokers.ts): exports `JOKER_CATALOG`, `JokerId` union type, `getJoker(id)`.
- New file [src/components/common/JokerIcon.tsx](../src/components/common/JokerIcon.tsx): exports `<JokerIcon id={} theme={} size={} />` (stroke-based inline SVGs, theme-aware via `THEME_ICONS`) and `hasJokerIcon(id)` (used by the catalog test).
- `GameshowConfig.enabledJokers?: string[]` (new optional field in [src/types/config.ts](../src/types/config.ts)).
- `AppConfig.jokersInLastGame?: boolean` (top-level, default `false`) — when `true`, jokers stay available in the last game.
- `AppConfig.jokerUsageScope?: JokerUsageScope` (`'per-gameshow' | 'per-game'`, top-level, default `'per-gameshow'`) — joker lifecycle; type alias `JokerUsageScope` exported from [src/types/config.ts](../src/types/config.ts).
- `SettingsResponse.enabledJokers: string[]`, `SettingsResponse.jokersInLastGame?: boolean`, and `SettingsResponse.jokerUsageScope?: JokerUsageScope` — derived from config on the server (`jokersInLastGame: config.jokersInLastGame === true`; `jokerUsageScope: config.jokerUsageScope === 'per-game' ? 'per-game' : 'per-gameshow'`).
- `GlobalSettings.jokersInLastGame: boolean` (frontend state, defaults `false`) and `GlobalSettings.jokerUsageScope: 'per-gameshow' | 'per-game'` (defaults `'per-gameshow'`).
- `COMEBACK_JOKER_ID = 'comeback'` constant exported from [src/data/jokers.ts](../src/data/jokers.ts) — the joker exempt from the `per-game` refresh.
- `SET_CURRENT_GAME` extended: in `per-game` scope, on a game-index change it clears non-`comeback` joker arrays (see acceptance criteria).
- `TeamState.team1JokersUsed: string[]`, `TeamState.team2JokersUsed: string[]`.
- `GlobalSettings.enabledJokers: string[]`.
- New reducer actions: `USE_JOKER`, `SET_JOKER_USED`, `RESET_JOKERS`, `SET_JOKERS_STATE`.
- `RESET_POINTS` extended to clear joker arrays.
- `GamemasterCommand` controlId `use-joker` with value `{ team, jokerId, used: 'true' | 'false' }`.
- localStorage keys: `team1JokersUsed`, `team2JokersUsed` (JSON-encoded string arrays).

## UI behaviour
- `TeamJokers` — compact grid rendered inside each team's header cell, separated from the points label by a subtle vertical divider so the jokers still read as "part of" that team. Grid is count-adaptive, capped at 3 columns × 2 rows (max 6): 1→1×1, 2→2×1, 3→3×1, 4→2×2, 5→3×2 (one empty slot), 6→3×2 full. Icons are clamp(32px, 2.2vw, 40px) square buttons with a subtle glass plate; SVG inside is 24px via `<JokerIcon size={24}>`. Team 1 icons render right of the points label; Team 2 icons left of its label.
- **Responsive:** icons shrink to ~30px below 1024px. Below 768px the team pill switches to a vertical stack — points label on top, joker strip directly below, separated by a horizontal divider. On this breakpoint the joker strip is a single-row flex container where icons share the cell width equally (`flex: 1 1 0; aspect-ratio: 1; min-width: 20px; max-width: 40px`), so 6 active jokers squeeze together while fewer active jokers hit the 40px cap and render larger. Team cells get `min-width: 0` so they can shrink below their intrinsic content width on phones; below 480px the icon `min-width` drops to 14px so all 6 still fit at 375px viewport. `#gameNumber` keeps `white-space: nowrap` so "Spiel N von M" never wraps into a multi-line pill.
- States: available (full color, clickable, `aria-pressed="false"`) / used (greyscale + strike-through, still clickable to revert, `aria-pressed="true"`). In the last game the whole `TeamJokers` row returns `null` (renders nothing) unless `state.settings.jokersInLastGame` is `true`. `isLastGame` is derived from `state.currentGame`; when `currentGame` is null (e.g. home/summary screens), it's not the last game.
- Tooltip: CSS `::after` on hover/focus showing `name — description`, positioned BELOW the icon (since the header sits at the top of the viewport). Team 1 tooltips anchor to the left edge of the icon, Team 2 tooltips to the right, so tooltips never overflow the viewport edges.
- Admin: "Verfügbare Joker" styled toggle cards inside [GameshowEditor.tsx](../src/components/backend/GameshowEditor.tsx) — one button-card per catalog entry (SVG icon + name + description). No checkboxes. Click to toggle on/off; active cards get an accent border + highlighted icon, inactive cards are dimmed. Saved via existing `PUT /api/backend/config` autosave flow.
- Gamemaster: new Joker section on `/gamemaster`, only rendered when a frontend is currently broadcasting gamemaster-answer data — hidden while the GM waiting screen ("Gamemaster-Ansicht") is shown. **Collapsed by default** — the header renders as a button showing "Joker" + a `used / total` counter + chevron; click to expand. When expanded, two sub-cards (Team 1 / Team 2) appear with a toggle switch per enabled joker. GM toggles fire `use-joker` commands. The whole section is hidden in the last game (using the WS-broadcast `gameIndex`/`totalGames`) unless `jokersInLastGame` is enabled.
- Global rules screen: when the active gameshow has enabled jokers, the `GlobalRulesScreen` renders the joker explanation (`config.jokerRules`, or the `GENERIC_JOKER_RULES` default when unset) as a second `<ul id="globalRulesJokerList">` below the configured rules — a generic "each team has jokers, single-use per show" explanation for players (the projected show can't use header hover tooltips). Independent of the last-game hiding logic (the rules screen only ever precedes game 0). Mirrored in [ThemeShowcase.tsx](../src/components/screens/ThemeShowcase.tsx) "Rules Container" (which uses the default text as a representative example).
- Rules-screen fit: because the joker block adds lines, `.rules-container` ([src/styles/screens.css](../src/styles/screens.css)) uses height-aware vertical rhythm (vertical padding, `h1`/list margins, `padding-top` of the joker divider all `clamp(min, Nvh, max)`, and list `font-size` `clamp(1.05em, 2.5vh, 1.2em)` with `line-height: 1.5`) so the full rule set + joker block stays on one screen at Full HD, and relaxes to full size on taller 1440p/4K displays. On `min-width: 1024px` the card also gets `max-height: calc(100dvh - clamp(52px, 9vh, 100px))` + `overflow-y: auto` as a safety net for unusually long rule lists (the page never scrolls); this cap is intentionally off below 1024px so phones keep natural page scrolling instead of a clipped inner-scroll card.

> **Exception — the `comeback` joker (Aufholjoker) has a real scoring effect.** It is the one joker
> that the app enforces automatically: only the trailing team may arm it, and it doubles that team's
> next awarded game's positional points. See [comeback-joker.md](comeback-joker.md). All other jokers
> remain GM-resolved with no effect logic.

## Out of scope
- Automatic enforcement of joker effects (sit-outs, solo answers, double-answer scoring, AI integration) — except the `comeback` joker's point doubling (see above).
- `countPerTeam` or multi-use jokers.
- Undo history beyond the GM's toggle.
- CRUD of catalog entries from admin — adding a joker is a code change via the `add-joker` skill.
