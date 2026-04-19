# Spec: Jokers

## Goal
Give each team a set of single-use jokers they can spend during a gameshow; admin selects which jokers are available per gameshow; the gamemaster (GM) resolves effects manually — the app only tracks "used" state.

## Acceptance criteria
- [ ] Joker catalog is hardcoded in [src/data/jokers.ts](../src/data/jokers.ts) as `JOKER_CATALOG: readonly JokerDef[]`; no admin CRUD, no JSON file.
- [ ] `GameshowConfig.enabledJokers: string[]` selects a subset of catalog IDs per gameshow.
- [ ] Admin "Verfügbare Joker" checklist in the gameshow editor lets the operator toggle which catalog entries are enabled.
- [ ] A persistent `JokerBar` renders inside `BaseGameWrapper` during every phase (landing/rules/game/points), team1 left / team2 right.
- [ ] Each bar shows one icon per enabled joker — emoji rendered directly as text.
- [ ] Clicking an available icon marks that joker used for that team and emits a `use-joker` gamemaster command so both tabs stay in sync.
- [ ] Used jokers are rendered greyscale + strike-through and are not clickable.
- [ ] When `currentIndex === totalGames - 1`, all unused jokers are disabled (cannot be clicked) on the frontend.
- [ ] Hovering/focusing a joker icon reveals a tooltip with the joker's name and description.
- [ ] The `GamemasterScreen` has a per-team Joker section with a toggle per enabled joker; the GM can override used/unused state at any time.
- [ ] Joker state is persisted to localStorage (`team1JokersUsed`, `team2JokersUsed`) and syncs between tabs via the storage event.
- [ ] `RESET_POINTS` also clears both joker arrays (single-run lifecycle).
- [ ] `validate-config.ts` emits an `invalid-joker-id` diagnostic when `enabledJokers` references an ID not in the catalog.
- [ ] Theme showcase has a JokerBar preview with available, used, and last-game-locked states.

## State / data changes
- New file [src/types/jokers.ts](../src/types/jokers.ts): `JokerDef { id; name; description; icon }`, `JokerTeam`.
- New file [src/data/jokers.ts](../src/data/jokers.ts): exports `JOKER_CATALOG`, `JokerId` union type, `getJoker(id)`.
- `GameshowConfig.enabledJokers?: string[]` (new optional field in [src/types/config.ts](../src/types/config.ts)).
- `SettingsResponse.enabledJokers: string[]` — derived from active gameshow's config on the server.
- `TeamState.team1JokersUsed: string[]`, `TeamState.team2JokersUsed: string[]`.
- `GlobalSettings.enabledJokers: string[]`.
- New reducer actions: `USE_JOKER`, `SET_JOKER_USED`, `RESET_JOKERS`, `SET_JOKERS_STATE`.
- `RESET_POINTS` extended to clear joker arrays.
- `GamemasterCommand` controlId `use-joker` with value `{ team, jokerId, used: 'true' | 'false' }`.
- localStorage keys: `team1JokersUsed`, `team2JokersUsed` (JSON-encoded string arrays).

## UI behaviour
- `JokerBar` — fixed at bottom of viewport across all BaseGameWrapper phases. Two columns (team1 left, team2 right) that stack vertically below 640px. Icons are 48×48 buttons (32×32 <768px); emoji rendered directly — no `dangerouslySetInnerHTML`.
- States: available (full color, clickable) / used (greyscale + strike-through, `aria-disabled`) / last-game-locked (~0.4 opacity, tooltip appends "(im letzten Spiel gesperrt)").
- Tooltip: CSS `::after` on hover/focus showing `name — description`.
- Admin: "Verfügbare Joker" checklist inside [GameshowEditor.tsx](../src/components/backend/GameshowEditor.tsx) — iterates over `JOKER_CATALOG`, one row per entry (icon + name + description + checkbox). Toggling saves via existing `PUT /api/backend/config` flow.
- Gamemaster: new Joker section with two sub-cards (Team 1 / Team 2); each enabled joker has a toggle switch. GM overrides fire `use-joker` commands. An "Im letzten Spiel erlauben" override checkbox bypasses the last-game lock.

## Out of scope
- Automatic enforcement of joker effects (sit-outs, solo answers, double-answer scoring, AI integration).
- `countPerTeam` or multi-use jokers.
- Undo history beyond the GM's toggle.
- CRUD of catalog entries from admin — adding a joker is a code change via the `add-joker` skill.
