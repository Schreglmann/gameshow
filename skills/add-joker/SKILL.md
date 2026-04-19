# Skill: Add New Joker

You are helping the user add a new joker to the gameshow project. Jokers are per-team, single-use powers that teams can spend during a gameshow — the catalog is hardcoded in TypeScript, and adding one is a small, well-scoped code change.

**Rule:** the whole joker system is catalog-driven off [src/data/jokers.ts](../../src/data/jokers.ts). Adding a joker must touch ONLY that file (and optionally [specs/jokers.md](../../specs/jokers.md) if the change is notable). Do not add new components, actions, API endpoints, or effect logic — the spec decision is that effects are resolved manually by the gamemaster.

Read the spec at [specs/jokers.md](../../specs/jokers.md) before starting.

---

## Phase 1 — Gather requirements

Before editing anything, ask the user for:

1. **Joker `id`** — kebab-case, unique. Must not already exist in [src/data/jokers.ts](../../src/data/jokers.ts).
2. **Name in German** — display label (e.g. `"Telefonjoker"`). Appears in the joker bar tooltip, the admin checklist, and the GM controls.
3. **Description in German** — one sentence describing what happens when the joker is used. Appears in the tooltip and the GM UI. Make it unambiguous enough that the GM knows how to resolve it without consulting the user.
4. **Icon** — **a single emoji**. If the user suggests SVG, an image URL, or a multi-glyph sequence, redirect firmly: the whole visual system is emoji-only, the catalog test (`tests/unit/data/jokers.test.ts`) enforces this, and inline SVG would reintroduce XSS surface that emoji avoids.

Do not proceed to Phase 2 until every field has a concrete answer.

---

## Phase 2 — Update the catalog

Open [src/data/jokers.ts](../../src/data/jokers.ts) and append a new entry to the `JOKER_CATALOG` array. Match the existing formatting exactly:

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
    icon: '🎲',
  },
] as const;
```

Do **NOT** touch any other file. No changes to components, no actions, no styles, no server code.

---

## Phase 3 — Verify

Run in order:

1. `npm run typecheck` (or `npx tsc --noEmit`) — confirms the `JokerId` literal union updates cleanly and nothing referencing catalog IDs broke.
2. `npm run test:related -- src/data/jokers.ts` — runs the catalog shape test at [tests/unit/data/jokers.test.ts](../../tests/unit/data/jokers.test.ts) plus any consumers. All tests must pass.
3. `npm run validate` — confirms `config.json` + any `enabledJokers` references still resolve to valid IDs.

Visual verification (use Playwright MCP if available):

4. Open `/theme-showcase` → scroll to the "JokerBar" section. Confirm the new emoji renders correctly at 375 / 768 / 1024 / 1920 px (per [AGENTS.md §7](../../AGENTS.md) responsive rule) — icons should be legible at every size. If the new joker doesn't appear, it's because the showcase currently samples only the first 4 catalog entries; enable the new id in a test gameshow's `enabledJokers` via `/admin` → Config → any gameshow's "Verfügbare Joker" checklist to see it in the JokerBar.
5. Open `/admin` → Config tab → pick any gameshow. The "Verfügbare Joker" checklist must include the new entry with the correct icon + name + description.
6. Optional end-to-end: open two tabs — `/game/0` and `/gamemaster` — in a gameshow where the new joker is enabled. Click the joker icon on the game tab → it greys out and the GM toggle flips. Toggle on the GM tab → the game-tab icon greys out. Cross-tab sync must work.

---

## Phase 4 — Update spec if warranted

[specs/jokers.md](../../specs/jokers.md) does NOT list individual catalog entries. Only update the spec if the new joker introduces a *new kind of GM resolution* that's worth documenting (e.g. a joker that requires a new GM tool). Routine additions do not change the spec.

---

## Phase 5 — Optional: expose in an active gameshow

If the user wants to enable the new joker in a specific gameshow immediately:

1. Open `/admin` → Config tab.
2. Find the gameshow.
3. Check the new joker in its "Verfügbare Joker" section. The checkbox state auto-saves via the existing `PUT /api/backend/config` debounce.

Otherwise, leave `enabledJokers` untouched — operators pick what's available per event.

---

## Constraints — never violate

| Rule | Why |
|------|-----|
| Icons MUST be a single emoji | Catalog test enforces this; it keeps the visual system consistent and the renderer safe (no `dangerouslySetInnerHTML`). |
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
- Remove a joker from the catalog. If the user wants a joker gone, it is safer to leave the catalog entry and simply uncheck it in every gameshow's `enabledJokers` — deleting the entry and then running a gameshow that still references it causes the validator to fail.
