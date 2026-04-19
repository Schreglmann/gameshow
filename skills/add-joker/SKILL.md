# Skill: Add New Joker

You are helping the user add a new joker to the gameshow project. Jokers are per-team, single-use powers that teams can spend during a gameshow — the catalog is hardcoded in TypeScript, and adding one is a small, well-scoped code change.

**Rule:** the whole joker system is catalog-driven off [src/data/jokers.ts](../../src/data/jokers.ts) plus the icon registry in [src/components/common/JokerIcon.tsx](../../src/components/common/JokerIcon.tsx). Adding a joker touches ONLY those two files (and optionally [specs/jokers.md](../../specs/jokers.md) if the change is notable). Do not add new components, actions, API endpoints, or effect logic — the spec decision is that effects are resolved manually by the gamemaster.

Read the spec at [specs/jokers.md](../../specs/jokers.md) before starting.

---

## Phase 1 — Gather requirements

Before editing anything, ask the user for:

1. **Joker `id`** — kebab-case, unique. Must not already exist in [src/data/jokers.ts](../../src/data/jokers.ts).
2. **Name in German** — display label (e.g. `"Telefonjoker"`). Appears in the joker bar tooltip, the admin toggle card, and the GM controls.
3. **Description in German** — one sentence describing what happens when the joker is used. Appears in the tooltip and the GM UI. Make it unambiguous enough that the GM knows how to resolve it without consulting the user.
4. **Icon concept** — a short textual description of the icon (e.g. "phone", "crossed-out person", "target", "volume with slash", "lightbulb"). The icon will be implemented as a stroke-based inline SVG matching the existing lucide-style set. If the user suggests an emoji or image URL, redirect: the visual system is inline SVG only.
5. **Theme-specific icon variant?** — usually not needed. Only ask if the user requests a visually distinct icon for one or more themes. Most jokers share a single icon that picks up theme color via `currentColor`.

Do not proceed to Phase 2 until every field has a concrete answer.

---

## Phase 2 — Update the catalog AND register an icon

**Two files must change, in this order:**

### 2a. Append the catalog entry — [src/data/jokers.ts](../../src/data/jokers.ts)

Append a new entry to the `JOKER_CATALOG` array. Match the existing formatting exactly:

- Multi-line object-literal with each field on its own line.
- Trailing comma after the last field.
- The `as const` assertion at the end of the array must be preserved.
- Keep the file ending with a trailing newline.

Example diff:

```ts
  {
    id: 'my-new-joker',
    name: 'Deutsches Label',
    description: 'Deutsche Beschreibung in einem Satz.',
  },
] as const;
```

There is NO `icon` field in the catalog entry — icons live in the registry (next step).

### 2b. Register the SVG icon — [src/components/common/JokerIcon.tsx](../../src/components/common/JokerIcon.tsx)

1. Define a new icon component near the existing icons (e.g. `CallFriendIcon`, `PlayerOutIcon`). Follow the established pattern:
   - Spread `strokeProps(size)` onto `<svg>` so stroke width, viewBox, and line caps match the rest of the catalog.
   - Shapes use `stroke="currentColor"` — no hard-coded colors. This lets the icon pick up the active theme's text color.
   - Keep the SVG source under ~8 lines; if a shape needs more, simplify it.
   - Include `aria-hidden="true"` on the `<svg>` element.
2. Add the component to the `BASE_ICONS` object, keyed by the new joker id.
3. Theme-specific variant (only if asked): add an entry under `THEME_ICONS[themeId][jokerId]`. Unspecified themes fall back to `BASE_ICONS`.

The catalog test at [tests/unit/data/jokers.test.ts](../../tests/unit/data/jokers.test.ts) fails the build if any catalog id lacks a registered icon — that's the guarantee that the catalog and the icon registry stay in sync.

Do **NOT** touch any other file. No changes to reducers, actions, API endpoints, styles outside the icon component, or server code.

---

## Phase 3 — Verify

Run in order:

1. `npm run typecheck` (or `npx tsc --noEmit`) — confirms the `JokerId` literal union updates cleanly and nothing referencing catalog IDs broke.
2. `npm run test:related -- src/data/jokers.ts src/components/common/JokerIcon.tsx` — runs the catalog shape test (including icon-registry coverage) plus any consumers. All tests must pass.
3. `npm run validate` — confirms `config.json` + any `enabledJokers` references still resolve to valid IDs.

Visual verification (use Playwright MCP if available):

4. Open `/theme-showcase` → scroll to the "JokerBar" section. The showcase currently renders only the first 4 catalog entries; to see the new icon specifically, enable it in a test gameshow's `enabledJokers` via `/admin` → Config → any gameshow's "Verfügbare Joker" section, then open `/game?index=0`. Confirm the icon renders at 375 / 768 / 1024 / 1920 px — the stroke should stay legible at every size.
5. Open `/admin` → Config tab → pick any gameshow. The "Verfügbare Joker" section must include the new entry as a toggle card with the correct icon, name, and description. Toggling to active must highlight the card with the accent color.
6. Optional end-to-end: open two tabs — `/game?index=0` and `/gamemaster` — in a gameshow where the new joker is enabled. Click the joker icon on the game tab → it greys out and the GM toggle flips. Toggle on the GM tab → the game-tab icon greys out. Cross-tab sync must work.

---

## Phase 4 — Update spec if warranted

[specs/jokers.md](../../specs/jokers.md) does NOT list individual catalog entries. Only update the spec if the new joker introduces a *new kind of GM resolution* that's worth documenting (e.g. a joker that requires a new GM tool). Routine additions do not change the spec.

---

## Phase 5 — Optional: expose in an active gameshow

If the user wants to enable the new joker in a specific gameshow immediately:

1. Open `/admin` → Config tab.
2. Find the gameshow.
3. Click the new joker's card in its "Verfügbare Joker" section. The active state auto-saves via the existing `PUT /api/backend/config` debounce.

Otherwise, leave `enabledJokers` untouched — operators pick what's available per event.

---

## Constraints — never violate

| Rule | Why |
|------|-----|
| Icons MUST be stroke-based inline SVG with `currentColor` | The visual system uses lucide-style strokes everywhere; `currentColor` lets themes tint the icon via CSS color inheritance. No emoji, no bitmap images, no filled shapes in brand colors. |
| Every catalog entry MUST have an icon in the registry | `tests/unit/data/jokers.test.ts` enforces this — adding a catalog entry without registering an icon will fail the build. |
| All text MUST be German | Player-facing language is German throughout — see [AGENTS.md §7](../../AGENTS.md). |
| Never change or remove an existing joker's `id` | IDs are referenced by `config.json` and persisted in live localStorage (`team1JokersUsed` / `team2JokersUsed`) on deployed instances. Renaming corrupts state. |
| Never add effect logic for a joker | The architectural decision in [specs/jokers.md](../../specs/jokers.md) is that GM resolves effects manually. If the user wants structured enforcement, that is a NEW spec — direct them to write one under `specs/`, don't extend this skill. |
| Never introduce a new API endpoint | Catalog lives in code; the `/api/settings` response already carries `enabledJokers`. No backend work needed. |
| Never delete a failing test to make the suite green | Fix the code or update the test. Per [AGENTS.md §7](../../AGENTS.md). |
| File must end with trailing newline | JSON + TS convention across the repo. |

---

## What this skill explicitly will NOT do

- Edit a joker's id (would break existing gameshows). Propose a second joker with a new id and mark the old one deprecated if needed.
- Implement auto-enforcement of joker effects (player sit-outs, double-answer scoring, AI integration). Those are separate specs and separate PRs.
- Remove a joker from the catalog without also removing it from the icon registry AND checking that no `config.json` gameshow still references it (the validator will flag leftover references).
