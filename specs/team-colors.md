# Spec: Per-team colours

## Goal

Let the operator pick a colour per team in advance — in the admin **Konfiguration**
tab — and have that colour mark the team on *every* surface that renders it: the
show, the gamemaster and the admin. Before this, a per-team colour existed only as
a theme detail (`--team1-house` … `--team4-house`, set by 4 of 13 themes) and was
consumed by exactly one rule: the accent ring on the team cards of the
setup/randomization screen. It was neither configurable nor visible anywhere else.

## Model

Two global fields plus a per-team colour with **three** states — the middle one is
the part that is easy to get wrong:

| `AppConfig.teamColors[key]` | meaning |
|---|---|
| absent | the operator never touched it → the pre-filled `DEFAULT_TEAM_COLORS` applies |
| `''` (blank) | explicit "no colour" → fall back to the active theme's `--teamN-house`, then to nothing |
| `'#rrggbb'` | that colour, overriding the theme |

So blank ≠ default. That is why the admin persists `''` on clear rather than
deleting the key, and why `normalizeTeamColors` keeps an empty string.

### The default palette

`DEFAULT_TEAM_COLORS` in [src/utils/teamColors.ts](../src/utils/teamColors.ts):

| Team | Colour | Origin |
|---|---|---|
| 1 | `#ff5d6c` | Atlas `--team1-house` |
| 2 | `#4f8af0` | Atlas `--team2-house` |
| 3 | `#3ed79a` | Atlas `--team3-house` |
| 4 | `#e0c918` | lemon yellow — deliberately **not** Atlas's `--team4-house` |

Teams 1-3 match the default theme's own house colours, so switching the feature on
does not introduce a second, competing set of "default" team colours. Team 4 is the
exception: Atlas rings it in violet, which at a distance is a third cool hue beside
the blue and the green, so the default is a yellow that separates from all three.
The theme keeps its violet — house colours are the theme's design and still apply
wherever the operator clears a colour.

The yellow is a lemon one (hue ~53°) rather than the gold a "yellow" naturally
drifts to, and darkened to L\*≈81. Gold is this app's *selected / winner* signal
(`--gold` `#ffd45e` on the award card, the winning guess row, the quizjagd team
label), so a gold-leaning team colour would both read as a result and disappear
against those surfaces. The darkening puts it beside the green (L\*≈77) instead of
shouting over all three at yellow's natural L\*>90.

## Resolution order

The master switch is applied in exactly ONE place — `resolveTeamColors(config)` in
[src/utils/teamColors.ts](../src/utils/teamColors.ts), called server-side by
`GET /api/settings` (the same discipline as `resolveShowTitle`, `normalizePointMode`
and `effectiveTeamCount`):

1. `AppConfig.teamColorsEnabled !== true` → `{}`. Clients then behave exactly as
   they did before the feature existed; no client re-derives the flag, which is why
   `teamColorsEnabled` is deliberately **not** on the wire.
2. Otherwise the configured palette, with `DEFAULT_TEAM_COLORS` filling in every
   key the operator never touched.

From there the colour reaches the DOM through CSS, not through props:

```
GET /api/settings → SettingsResponse.teamColors → GlobalSettings.teamColors
  → useTeamColorVars()   (one effect inside GameProvider)
      → html style="--team1-color: #ff5d6c; …"  +  html[data-team-colors="on"]
          → [data-team="teamN"] { --team-color: var(--teamN-color, var(--teamN-house, transparent)); }
              → every render site reads var(--team-color)
```

Each render site's whole contribution is `data-team={teamKey}` — no import, no hook,
no per-site colour lookup. The stylesheet, not JavaScript, expresses the
configured → theme → nothing fallback, because JS cannot read a theme's house colour
without a `getComputedStyle` re-run on every theme swap.

All three PWAs mount `<GameProvider>`, which already loads settings on mount and
re-loads them on the `content-changed` channel — so one call site covers the show,
the gamemaster, the admin and `/theme-showcase`, and a live admin edit reaches a
running show with no reload (see [live-config-reload.md](live-config-reload.md)).

## State / data changes

- `AppConfig.teamColorsEnabled?: boolean` — master switch, opt-in (`=== true`).
- `AppConfig.teamColors?: TeamColors` — `Partial<Record<TeamKey, string>>`, values
  `#rrggbb` or `''`. Type declared in [src/types/config.ts](../src/types/config.ts).
- `SettingsResponse.teamColors?: TeamColors` — already gated, so an empty/absent map
  means "mark nothing" (optional on the wire so existing fixtures need not provide it).
- `GlobalSettings.teamColors: TeamColors` — always present after
  `normalizeTeamColors()`; `getInitialState` seeds `{}`.
- `TeamState` is **untouched**. A config-authored colour is not live show state: it
  must not ride the `gamemaster-team-state-v2` channel or localStorage.
- No new `AppState` action — the value rides along in the existing `SET_SETTINGS`
  payload. Nothing is persisted to localStorage.
- No new route and no new WS channel.

## Visual contract

Accent only. The colour marks a team through **one edge per surface plus a dot next
to its name**; it never changes text colour and never tints or fills a background.
That keeps all 13 themes legible without per-theme tuning, and it is why the feature
can be switched off with a byte-identical result.

Three tokens in [src/styles/team-accent.css](../src/styles/team-accent.css), each
appended by a surface to its own `box-shadow` list:

| Token | Shape when on | Used by |
|---|---|---|
| `--team-ring` | `inset 0 0 0 2px` | cards that stand alone (result rows, team cards) |
| `--team-edge-left` | `inset 3px 0 0 0` | rows, panels and entry cards (award cards, GM/admin panels) |
| `--team-edge-bottom` | `inset 0 -2px 0 0` | header cells and table column heads |

A token holds the **geometry only**, and every use site appends the colour:

```css
box-shadow: <the surface's own shadows>, var(--team-edge-left) var(--team-color);
```

A token must never contain `var(--team-color)` itself. A `var()` nested inside a
custom property is substituted when that property is computed — on the element
that *declares* it, `<html>`, where `--team-color` does not exist. The token then
becomes the guaranteed-invalid value and every `box-shadow` reading it computes to
`none`. That failure is silent and total: the accents render nothing at all while
the dots, which read `--team-color` directly, keep working.

Switched off, the geometry is a zero-size inset (`inset 0 0 0 0`), so the shadow
is present but invisible. Gating the *geometry* rather than the colour is also
what keeps a theme's house colours off these surfaces while the operator has team
colours off — `--team-color` alone still resolves to the house colour on Harry
Potter, D&D and Atlas.

Every accent is an **inset** shadow, so it never participates in layout —
switching the feature off cannot shift a single pixel. The gate is
`html[data-team-colors="on"]` (specificity 0,1,1, so stylesheet order cannot let
the `:root` no-op defaults win) plus a `.team-colors-on` class that lets
`ThemeShowcase` demo the accent regardless of the live config.

Two rules replace a `box-shadow` wholesale and therefore re-append the token
themselves: `.award-team-card.is-selected` / `.guess-result-team.is-winner` (the
gold glow), and `header div:hover` / `.team:hover` (the hover glow). Atlas and
Atlas-Light additionally set `box-shadow: none` on the first pair, so
[themes.css](../src/styles/themes.css) restores the edge for them at higher
specificity.

`<TeamDot>` ([src/components/common/TeamDot.tsx](../src/components/common/TeamDot.tsx))
is `display: none` until the flag is on, carries its own `data-team`, is
`aria-hidden` (it never carries meaning on its own — the team name is always beside
it), and has a hairline `inset 0 0 0 1px` ring in the surrounding text colour so a
pale colour on an ivory card still reads as a disc.

## UI behaviour

**Show**

- `HomeScreen` team cards — the accent ring, as before, but now sourced from
  `--team-color`, so a configured colour overrides the theme's house colour. The
  ring is **ungated**: the house ring predates this feature and keeps rendering with
  the switch off.
- `Header` — bottom edge on each `.team-header-cell`, dot before the team name (only
  where a name is printed at all: at 0–1 teams the label collapses to a bare score,
  see [team-count.md](team-count.md)).
- `AwardPoints` — left edge on each `.award-team-card` in both the read-only and
  the selectable branch, and in the `is-selected` state; dot in the card name.
- `GuessingGame` — both the entry cards ("Tipp Team 1:") and the result rows.
- `BetQuiz` / `WerKenntMehr` team-choice columns, `FinalQuiz` bet inputs (the edge
  alone — a placeholder cannot hold a dot) and judgment headings, `Quizjagd` team
  label, `SummaryScreen` winner announcement (single-winner case only — a draw
  names no team).
- `TeamJokers` needs nothing of its own: the joker grid sits inside the header
  cell that is already marked, and a second edge there would only be noise.

**Gamemaster** — `GamemasterView` joker cards + the joker-confirm toast,
`CorrectAnswersTracker` team cards, `QuestionScorePanel` column heads and cells,
`ScoreHistoryPanel` rows.

**Admin** — the per-team blocks in the `SessionTab` "Team Verwaltung" grid, so the
operator sees which team is which colour while editing it.

**Admin Konfiguration**

- A "Team-Farben" toggle in the "Globale Einstellungen" card.
- A "Team-Farben" card with four colour fields (`Farbe Team 1` … `Farbe Team 4`),
  each a `ColorPickerField`: a swatch opening the native picker plus a validated
  `#rrggbb` text field. Fields prefill with the default palette; the ✕ clears a
  field to `''` ("Farbe des aktiven Themes"). All four are editable regardless of
  the active gameshow's team count — picking in advance is the point — but the ones
  above that count carry the existing italic lock hint. Autosave only, through
  `useEditableConfig` → `saveQueue`; no save button.

**Edge cases**

- Switch off → `{}` on the wire → no dot, no edge, and the theme house ring behaves
  exactly as before the feature existed.
- Switch on with a blank field on a theme that defines no house colour → no edge and
  an invisible dot (which still occupies its ~0.6 em box; the surrounding flex gap
  is the only trace).
- The admin sees its own edit after the autosave round-trip (~1 s: debounce → write
  → `content-changed` → settings re-fetch). The picker swatch itself is driven by
  the local draft and updates instantly.
- `/theme-showcase` nested theme panels reset `--teamN-color` to `initial`, so each
  panel keeps demonstrating *that theme's* house colours rather than inheriting the
  operator's palette from `<html>`. See [themes.md](themes.md).

## Validation

`validate-config.ts`:

- error on a non-boolean `teamColorsEnabled`;
- error on a `teamColors` that is not a plain object, on an unknown key, on a
  non-string value, and on a non-`#rrggbb` value;
- warning on a blank value (that team falls back to the theme colour) and on
  `teamColors` being set while `teamColorsEnabled` is not `true` (nothing is marked).

## Acceptance criteria

- [x] `resolveTeamColors()` is the only place the master switch is evaluated; off ⇒ `{}`
- [x] With the switch on and `teamColors` absent, all four teams get `DEFAULT_TEAM_COLORS`
- [x] A configured `#rrggbb` overrides the active theme's `--teamN-house`
- [x] A blank field falls back to `--teamN-house`, then to no accent at all
- [x] `GET /api/settings` serves the resolved `teamColors`
- [x] `useTeamColorVars` publishes `--team1-color` … `--team4-color` on `<html>` and
      *removes* (never blanks) the property for an absent/blank key
- [x] Every team surface listed under **UI behaviour** carries `data-team` and shows
      the accent in all three zones
- [x] Text colour is never changed and no background is tinted or filled
- [x] With the switch off, the show / gamemaster / admin render pixel-identically to
      before the change (verified on `atlas` and `harry-potter`)
- [x] The admin Konfiguration tab has the toggle plus four colour fields, prefilled,
      clearable to `''`, autosaved
- [x] An invalid hex is rejected with a German message and does not reach `config.json`
- [x] A live edit reaches a running show without a reload (`content-changed` re-fetch)
- [x] `validate-config.ts` errors and warns as listed under **Validation**
- [x] `specs/api/openapi.yaml` documents `TeamColors`, the two `AppConfig` fields and
      `SettingsResponse.teamColors`
- [x] `/theme-showcase` shows the accent + dot and the theme-fallback case, and its
      nested theme panels still demonstrate each theme's own house colours

## Related

- [team-count.md](team-count.md) — which teams exist (0–4) and the `--teamN-house` accents.
- [team-management.md](team-management.md) — team names, rosters and randomization.
- [themes.md](themes.md) — `--teamN-house`, the `:not()` isolation chains, and how a
  configured colour interacts with both.
- [live-config-reload.md](live-config-reload.md) — how a config edit reaches the show.

## Out of scope

- The generic gamemaster `input-group` / `button-group` controls (team-name inputs,
  bet fields, `select-team-N` buttons). Those are id-keyed `GamemasterInputDef` /
  `GamemasterButtonDef` payloads with no `TeamKey`, so marking them needs an additive
  `team?: TeamKey` on the `gamemaster-controls` channel — an AsyncAPI change plus the
  [server/ws.ts](../server/ws.ts) top comment and
  [docs/replace-gamemaster.md](../docs/replace-gamemaster.md). A possible phase 2.
- Per-gameshow colour overrides (`GameshowConfig.teamColors`) — the setting is global,
  like `teamMirrorEnabled`.
- Tinted or filled backgrounds, coloured text, avatars or logos per team.
- Auto-contrast adjustment or a palette generator; the operator's colour is used as
  picked.
- Colours on the 0–1-team surfaces — there is no team to mark there.
- Moving `--teamN-house` out of the shared `:root` block. Because it is declared
  there, six themes that the isolation chain does not list inherit the Atlas palette
  rather than resolving to nothing. Pre-existing, documented in
  [themes.md](themes.md), and a change of six themes' appearance in its own right.
