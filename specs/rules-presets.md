# Spec: Rules presets (per-game references to shared rule sets)

## Goal

Let the author assign a game's archetype rules (Archetypes A/B/C from [rules-standard.md](rules-standard.md), and any new Archetype X variants) by clicking a preset button in the admin rules editor. Presets are **references**, not copies: editing a preset's lines in `config.json` updates every game that references it, and clicking the active preset again deselects it and restores the game's previously-stored custom rules.

The first line — the **game-specific task line** — always lives in the game's own `rules[0]` and is always editable. Presets only contribute archetype lines from row 1 onward.

A preset also has to survive the show's **team count** (0–4, see [team-count.md](team-count.md)). The archetype wording is two-team wording ("Beide Teams", "das andere Team"), which is simply wrong at 3–4 teams and meaningless at 0–1, where whole lines lose their referent. A preset therefore carries up to three **bands** of rules, and the server picks the band matching the active gameshow's effective team count when it resolves the reference.

## Acceptance criteria

- [ ] `AppConfig` has an optional `rulesPresets: RulesPreset[]` field with `{ id: string; name: string; rules: string[]; rulesSolo?: string[]; rulesMulti?: string[] }`.
- [ ] `BaseGameConfig` has an optional `rulesPreset: string` field that references a preset by id.
- [ ] A preset resolves through the **team band** of the active gameshow's effective team count: `solo` (0–1 teams) → `rulesSolo`, `pair` (2) → `rules`, `multi` (3–4) → `rulesMulti`. A missing band falls back to `rules`, so a preset authored before this feature keeps behaving exactly as it did.
- [ ] `rulesTeamBand(teamCount)` and `presetRulesForTeamCount(preset, teamCount)` in [src/utils/rulesPreset.ts](../src/utils/rulesPreset.ts) are the single place the band is decided; server and admin both call them.
- [ ] `resolveRulesPreset(game, presets, teamCount?)` takes the effective team count; omitting it means `DEFAULT_TEAM_COUNT` (2), which is the pre-feature behaviour.
- [ ] `loadGameConfig` passes `effectiveTeamCount(config)` so `GET /api/game/:index` serves the band-correct rules. No client resolves a band for a player-facing screen.
- [ ] The five seed presets in [config.json](../config.json) and the four in [server/clean-install.ts](../server/clean-install.ts) author all three bands.
- [ ] `buildDefaultConfig()` (server/clean-install.ts) ships four seed presets (Archetypes A/B/C verbatim + the Archetype X "Gleichzeitig — erste richtige Antwort gewinnt, beliebig oft raten") into the default config written on a fresh/clean install.
- [ ] [validate-config.ts](../validate-config.ts) checks `rulesPresets` shape — including that `rulesSolo` / `rulesMulti`, when present, are arrays of strings — and warns (does not error) on dangling `rulesPreset` references.
- [ ] On `GET /api/game/:index`, the server resolves `rulesPreset` references inside `loadGameConfig` so the response payload always contains a flat `rules: string[]` and never includes `rulesPreset`.
- [ ] If a game's `rulesPreset` references a preset that exists, the server returns `[rules[0] ?? PLACEHOLDER_TASK_LINE, ...bandRules]`.
- [ ] If the referenced preset is missing, the server falls back to `rules` as-is, logs a warning, and strips `rulesPreset` from the response. Player-facing clients never see unresolved references.
- [ ] The admin per-game rules editor (`GameEditor` → `RulesEditor`) renders one button per preset alongside "+ Hinzufügen".
- [ ] Clicking an inactive preset sets `data.rulesPreset = preset.id`. Clicking the active preset sets `data.rulesPreset = undefined`. Clicking a different preset while one is active repoints `data.rulesPreset` without an intermediate undefined.
- [ ] The act of clicking a preset never mutates `data.rules` — the user's custom rules array is preserved on disk while a preset is linked.
- [ ] When a preset is active, the editor displays row 0 (the task line, editable) followed by the preset's rules rendered as **locked** rows (no `<input>`, no drag handle, no delete button). "+ Hinzufügen" is hidden.
- [ ] The locked rows and the preset buttons' hover title show the band for the **active gameshow's** team count, not always the two-team text — the editor shows what the show will actually render. `RulesEditor` takes a `teamCount` prop (default `DEFAULT_TEAM_COUNT`); `GameEditor` derives it from the loaded config.
- [ ] When the resolved band is not `pair`, the rules section names it (e.g. "Vorlagentext für 3–4 Teams") so the author knows which variant is on screen.
- [ ] When no preset is active, the editor behaves exactly as before — `rules` is displayed and edited row-by-row.
- [ ] Row 0 is visually distinguished in the per-game editor: an "Aufgabe" label/badge, a different placeholder (`"Beschreibe die Aufgabe der Runde."`), and a thin divider between row 0 and row 1. The delete button on row 0 is hidden — the rules array must always begin with a task line per [rules-standard.md](rules-standard.md).
- [ ] The active preset's button has a clearly distinguishable `.is-active` state (accent background using `--admin-accent-rgb`).
- [ ] The global-rules editor in `ConfigTab` is unchanged: no preset buttons, no Aufgabe-row styling, no row-0 protection. All new behaviour is opt-in via new `RulesEditor` props.
- [ ] If `rulesPresets` is missing or empty, no preset buttons render in `GameEditor`. The Aufgabe-row styling still applies (it's independent of presets).
- [ ] [specs/api/openapi.yaml](api/openapi.yaml) reflects the new `AppConfig.rulesPresets` and `BaseGameConfig.rulesPreset` shapes; `npm run contracts:lint` passes.
- [ ] [specs/rules-standard.md](rules-standard.md) gains the new Archetype X entry for preset #4 and a note that games may now link to a preset via `rulesPreset`.
- [ ] [ThemeShowcase](../src/components/screens/ThemeShowcase.tsx) has an admin example covering all new visual states.
- [ ] Unit tests cover RulesEditor behaviour (preset rendering, active state, toggle/switch handlers) and server preset resolution (found / missing / no reference).
- [ ] Responsive: preset buttons wrap cleanly at 375 px.

## State / data changes

**New TypeScript types** (in [src/types/config.ts](../src/types/config.ts)):

```ts
export interface RulesPreset {
  id: string;
  name: string;
  /** Band `pair` — 2 teams. Also the fallback for any band left unauthored. */
  rules: string[];
  /** Band `solo` — 0-1 teams. There is no other team to lose a turn to. */
  rulesSolo?: string[];
  /** Band `multi` — 3-4 teams. */
  rulesMulti?: string[];
}

export type RulesTeamBand = 'solo' | 'pair' | 'multi';

export interface AppConfig {
  // ...existing...
  rulesPresets?: RulesPreset[];
}

export interface BaseGameConfig {
  // ...existing...
  rules?: string[];
  rulesPreset?: string;
}
```

**No `AppState` changes.** Presets are config-only — they never enter the runtime React state.

**No new API endpoints.** `GET /api/backend/config` already returns the whole `AppConfig`, and `PUT /api/backend/config` already accepts it. `GET /api/game/:index` resolves preset references before responding.

**No localStorage changes.**

**On-disk format** for a game JSON file that links a preset:

```json
{
  "type": "simple-quiz",
  "title": "Logo Quiz",
  "rules": ["Es muss die Firma anhand des Logos erraten werden."],
  "rulesPreset": "alternating",
  "questions": [...]
}
```

`rules` keeps the task line (and possibly stale custom archetype lines, preserved across preset selection so they can be restored when the user deselects). `rulesPreset` is the runtime override.

**The game file never names a band.** A game links a preset by id; which band that resolves to is
decided by the show it is played in.

## Team bands

The band is a property of the **show**, not the game: presets are app-wide, the team count belongs to
the active gameshow, and the same preset can be served two different ways to two different shows.

| Band | Effective team count | Field | Why it differs |
|---|---|---|---|
| `solo` | 0, 1 | `rulesSolo` | No opponent exists. Lines about "das andere Team" have no referent and must be **dropped**, not reworded — which is why a band is a rule array and not a placeholder substitution. |
| `pair` | 2 | `rules` | The historic wording: "Beide Teams", "das andere Team". |
| `multi` | 3, 4 | `rulesMulti` | "Alle Teams", and the fallback partner becomes "die anderen Teams" (simultaneous archetypes) or "das nächste Team" (alternating, where turn order decides who is next). |

```ts
rulesTeamBand(teamCount)            // 0|1 → 'solo', 2 → 'pair', 3|4 → 'multi'
presetRulesForTeamCount(preset, n)  // the band's array, falling back to preset.rules
```

The effective team count is the one from [team-count.md](team-count.md) — `effectiveTeamCount(config)` —
so the global `pointSystemEnabled: false` lands in `solo` like any other 0-team show.

A band left unauthored falls back to `rules`. That is a deliberate soft failure: an operator who adds
a preset by hand and forgets `rulesMulti` gets the old (slightly wrong) text rather than an empty
rules list mid-show.

## Behaviour matrix

| `rulesPreset` | `rules[0]` | `rules.slice(1)` | Editor display | Editor edits |
|---|---|---|---|---|
| unset | present or empty | any | `rules` as-is | All rows; "+ Hinzufügen" enabled |
| unset | missing | — | Single Aufgabe placeholder row | All rows |
| set, preset exists | present or empty | preserved on disk, hidden in UI | `[rules[0] ?? placeholder, ...bandRules]` | Row 0 only; preset rows are locked |
| set, preset missing | — | — | Custom rules as-is + "Vorlage '<id>' nicht gefunden" warning | All rows |

Preset buttons:
- Click inactive → `onPresetChange(preset.id)`.
- Click active → `onPresetChange(undefined)`.
- Click another preset while one is active → `onPresetChange(newPreset.id)` (no toggle-off intermediate).

No `window.confirm` is invoked — selecting/deselecting a preset never destroys user data.

## UI behaviour

**Screen affected:** [src/components/backend/GameEditor.tsx:312-356](../src/components/backend/GameEditor.tsx#L312-L356) — the per-game rules editor section, via [src/components/backend/RulesEditor.tsx](../src/components/backend/RulesEditor.tsx).

**What the user sees:**
- Above the rules list nothing changes structurally; row 0 gains an "Aufgabe" badge and a divider below it.
- The bottom row shows "+ Hinzufügen" (when no preset is active) plus the parent-supplied `extra` (randomise toggles etc.), plus one button per preset, e.g. `[ Gleichzeitig schriftlich ]  [ Abwechselnd ]  [ Gleichzeitig (erste richtige gewinnt) ]`.
- When the user clicks a preset, that button gains the `.is-active` accent style; rows 1+ flip to muted, non-editable locked rows showing the preset's text; "+ Hinzufügen" disappears.
- Clicking the active preset (the highlighted button) restores the editor to free-form mode and rows 1+ revert to the user's previously-stored rules.

**Player-facing screens** ([BaseGameWrapper](../src/components/games/BaseGameWrapper.tsx), [GlobalRulesScreen](../src/components/screens/GlobalRulesScreen.tsx)): **no changes**. They keep iterating a flat `string[]`. The server has already merged the preset before they see it.

**Edge cases:**
- Game with `rulesPreset` but empty `rules`: server returns `[PLACEHOLDER_TASK_LINE, ...bandRules]`; editor shows the placeholder in row 0.
- Preset with no `rulesSolo` played at 1 team: falls back to `rules`, so the show reads the two-team text. The seed presets author every band; a hand-added one degrades rather than breaking.
- Preset whose band array is empty (`rulesSolo: []`): the game shows its task line alone. Legitimate — at one team some archetypes genuinely have nothing left to say.
- Game with `rulesPreset` referencing a deleted preset: server logs once and strips the field; editor surfaces a warning in the rules section.
- Author renames a preset's `name` field: button labels update everywhere; `id` is the stable identifier.
- Author renames a preset's `id` field: every game referencing the old id becomes a dangling reference (handled by the missing-preset fallback). This is intentional — id renames are breaking changes and should be done deliberately.
- Multi-instance games: `rulesPreset` is a top-level (per-game) field, not per-instance. Existing instance-level `rules` overrides still work; if both are present, the resolved instance `rules[0]` is used as the task line.

## Out of scope

- Migrating the ~30 games whose `rules` arrays hold inline two-team archetype text instead of a `rulesPreset` link. They keep the wording they have; linking them to a preset is what would make them count-aware.
- A dedicated admin UI for editing the `rulesPresets` list. The author edits `config.json` by hand for now (see [config-system.md](config-system.md)). A preset-CMS surface is a follow-up.
- Per-gameshow or per-game-type preset scoping (all presets are app-wide).
- Tooltip / preview of a preset's rule bodies before clicking.
- Allowing multiple preset references on one game.
- Inline override of individual preset lines while staying linked.
- Validation that `rules[0]` reads like a task line. The editor enforces position only.
- Auto-replacing the placeholder string on first focus / blur — the placeholder remains as literal text until the author overwrites it.
