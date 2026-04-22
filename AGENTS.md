# AGENTS.md — AI Development Guide

This file is for AI coding assistants (Claude Code, GitHub Copilot) working on this codebase.
Read it before making changes. Keep it updated as the project evolves.

> **For Claude Code:** this file is project context.
> **For GitHub Copilot:** keep this file open when working on state or game logic — the examples directly inform completions.

## Project Context

This is a TypeScript gameshow app with admin interface, DAM (Digital Asset Manager), WebSocket push architecture, and multiple game types (Bandle, image-guess, etc.). CSS uses component-scoped styles. Tests are run with the existing test suite (~940-979 tests). Always run tests after backend changes.

---

## 1. Project Orientation

Config-driven, modular gameshow web app. Entirely AI-generated, run at live in-person events.
Two teams compete across multiple game rounds. All player-facing content is in **German**.

**Tech stack:** React 19 · React Router 7 · Express · TypeScript · Vite · Vitest · Playwright

**Key commands:**
```bash
npm run dev        # dev mode (hot reload client + server)
npm run validate   # validate config.json + all game files — run after any config change
npm test           # unit + integration tests
npm run test:e2e   # Playwright end-to-end
npm run generate   # interactive config generator
```

**Start reading here:**
1. `src/types/config.ts` — all TypeScript types (source of truth)
2. `src/context/GameContext.tsx` — all app state
3. `MODULAR_SYSTEM.md` — architecture and config structure
4. `GAME_TYPES.md` — all 10 game types with config examples

---

## 2. Architecture Overview

### Data flow

```
config.json (git-crypt encrypted)
    └─ activeGameshow → gameshows[key].gameOrder
           └─ ["allgemeinwissen/v1", "quizjagd/v2", ...]
                  └─ server resolves → games/<name>.json
                         └─ GET /api/game/:index → GameDataResponse
                                └─ GameScreen → GameFactory → <GameComponent>
                                       └─ BaseGameWrapper → AwardPoints → onNextGame()
                                              └─ dispatch(AWARD_POINTS)
                                                     └─ localStorage
```

### Critical files

| File | Role |
|------|------|
| `src/types/config.ts` | All TypeScript types for configs, questions, API responses |
| `src/context/GameContext.tsx` | `AppState`, `Action` union, `reducer` — single source of truth |
| `src/types/game.ts` | `TeamState`, `GlobalSettings`, `CurrentGame` |
| `src/components/games/GameFactory.tsx` | Switch on `config.type` → game component |
| `src/components/games/BaseGameWrapper.tsx` | Shared shell: landing → rules → game → points → next |
| `src/components/common/AwardPoints.tsx` | Host UI for awarding points after a game |
| `server/index.ts` | All API routes; re-reads config on every request (intentional) |
| `server/asset-alias-map.ts` | Persistent map (`images/.asset-aliases.json`) consulted by auto-cover/poster downloaders so DAM merges aren't undone on the next fetch — see [specs/asset-merge.md](specs/asset-merge.md) |
| `src/services/api.ts` | Typed fetch wrappers for all API endpoints |
| `games/*.json` | Individual game definitions (33+ files) |
| `config.json` | Active gameshow selector + all gameshow definitions (encrypted) |
| `config.template.json` | Safe template for new configs |
| `specs/admin-backend.md` | Spec for the `/admin` backend CMS (games, assets, config, system status) |
| `src/data/jokers.ts` | Hardcoded joker catalog (`JOKER_CATALOG`) — add new entries via the `add-joker` skill |
| `src/components/common/JokerBar.tsx` | Persistent per-team joker UI rendered inside `BaseGameWrapper` (see [specs/jokers.md](specs/jokers.md)) |
| `src/entries/{frontend,admin,gamemaster}.tsx` | Three separate React entry points, one per installable PWA (see [specs/pwa.md](specs/pwa.md)) |
| `vite.config.{frontend,admin,gamemaster,dev,shared}.ts` | Per-PWA Vite build configs plus the dev-server multi-entry config |
| `{show,admin,gamemaster}/index.html` | HTML entries for the three PWAs; each links its own `manifest.webmanifest`. Root `/` redirects to `/show/` — scopes are disjoint so all three PWAs install separately (see [specs/pwa.md](specs/pwa.md)) |
| `src/hooks/useInstallPrompt.ts` + `src/components/common/InstallButton.tsx` | Cross-browser PWA install button (Chromium native prompt, Safari/Firefox manual-install popover) |
| `specs/api/openapi.yaml` | OpenAPI 3.1 for every HTTP route — formal contract for the show/admin/gamemaster PWAs. |
| `specs/api/asyncapi.yaml` | AsyncAPI 3.1 for every WebSocket channel at `/api/ws`. |
| `specs/api/inventory.md` | Human-readable catalog of every route + channel; source of truth for the YAMLs. |
| `docs/replace-frontend.md` / `docs/replace-admin.md` / `docs/replace-gamemaster.md` | Per-zone drop-in replacement guides — which endpoints + channels a replacement PWA must speak. |
| `tests/contracts/` | vitest suite validating live server responses against `openapi.yaml` / `asyncapi.yaml`. |

### API endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/settings` | `SettingsResponse` |
| `GET /api/game/:index` | `GameDataResponse` |
| `GET /api/background-music` | `string[]` of MP3 filenames |

Every route and channel is documented in [specs/api/openapi.yaml](specs/api/openapi.yaml) (HTTP) and [specs/api/asyncapi.yaml](specs/api/asyncapi.yaml) (WebSocket), grouped by zone. See [specs/api/README.md](specs/api/README.md) for the overview and [specs/api/inventory.md](specs/api/inventory.md) for the human-readable index.

Admin CMS endpoints live under `/api/backend/*` (games, assets, config, system status, gamemaster controls, clean-install, asset merge/dedup) — see [specs/admin-backend.md](specs/admin-backend.md) for the admin UX spec. A websocket layer for gamemaster controls and backend events lives in [server/ws.ts](server/ws.ts).

Per-video Whisper transcription jobs (start/pause/resume/stop, persistent across Node restarts) live under `/api/backend/assets/videos/whisper/*` — see [specs/whisper-transcription.md](specs/whisper-transcription.md). Job manager: [server/whisper-jobs.ts](server/whisper-jobs.ts). Setup: `npm run whisper:install && npm run whisper:download-model`.

---

## 2a. API contracts (first-class discipline)

The three PWAs (show / admin / gamemaster) are physically separate bundles that only talk to the backend via HTTP `/api/*` and WebSocket `/api/ws`. Any of them can be replaced by a drop-in alternative — but only if the contract is formally documented.

**The rule:** every change to an HTTP route or WebSocket channel MUST update the contract docs in the same commit. This is not a nice-to-have — it is the guarantee that makes "replaceable PWA" a property we actually have.

Concretely:

- Adding, removing, renaming, or changing the shape of a route → update [specs/api/openapi.yaml](specs/api/openapi.yaml) and (if the zone changes) [specs/api/inventory.md](specs/api/inventory.md) and the relevant [docs/replace-*.md](docs/) guide.
- Adding, removing, renaming, or changing the shape of a WebSocket channel → update [specs/api/asyncapi.yaml](specs/api/asyncapi.yaml) + [server/ws.ts](server/ws.ts) top-comment + inventory.
- Moving a route between zones (e.g. an admin endpoint that turns out to be show-only, like `stream-notify` did) → update the OpenAPI tag AND the relevant replacement guide(s).

**A task is not done if the contract docs don't match the code.**

### Commands

```bash
npm run contracts:lint      # redocly + asyncapi validation of the spec YAMLs
npm run test:contracts      # vitest: live server responses validated against schemas
```

`contracts:lint` must pass with zero errors. `test:contracts` auto-skips when no dev server is running, so it's safe in CI — but during local verification run `npm run dev` in one terminal and `npm run test:contracts` in another.

### Why this discipline

- Cheapest way to let a replacement frontend author know exactly what to implement — no reverse-engineering of [server/index.ts](server/index.ts).
- Cheapest way to catch silent shape changes: `test:contracts` flags a 500-line YAML drift the second you forget to update it.
- Makes the e2e tests portable. The [tests/e2e/contracts/openapi-live.spec.ts](tests/e2e/contracts/openapi-live.spec.ts) sanity-check runs against any backend that speaks the same contract.

---

## 3. Spec-Driven Development

**The rule:** write a spec before writing any code. The spec defines *what* to build; implementation follows from it.

### The mandatory sequence

```
Spec → Types → Implementation → Tests → Verify against spec
```

Never start coding a feature without a spec. Never close a feature without verifying it against the spec.

### What a spec looks like

Create a markdown file under `specs/` (e.g. `specs/my-feature.md`) with this structure:

```markdown
# Spec: My Feature

## Goal
One sentence describing what this feature does and why.

## Acceptance criteria
- [ ] Criterion 1 (observable, testable behaviour)
- [ ] Criterion 2
- [ ] ...

## State / data changes
- New field in AppState: `myField: string`
- New API endpoint: `POST /api/something` → `{ result: string }`
- Persisted to localStorage: yes / no

## UI behaviour
- Screen / component affected: `SummaryScreen`
- What the user sees: ...
- Edge cases: ...

## Out of scope
- Things explicitly NOT included in this feature
```

### Spec workflow for AI agents

**Every task — new feature or change to existing code — follows this workflow without exception.**

1. **Before starting:** read every spec in `specs/` that is relevant to the task. If none exists for the task, write one and confirm with the user before proceeding. If one exists but is outdated, update it before writing any code.
2. **During implementation:** tick off acceptance criteria as they are met. If the implementation must deviate from the spec, update the spec first — never silently diverge.
3. **After implementation:** verify every criterion is met — by running tests, manually testing in `npm run dev`, or both.
4. **Keep the spec current:** any change to behaviour, state shape, API contract, or UI that was not in the original spec must be added to the spec before the task is considered done. The spec is the authoritative description of what was built — it must always match reality.

> All existing feature specs live in [`specs/`](specs/). New feature specs go there before implementation starts. See [`specs/README.md`](specs/README.md) for the full index and the new-spec template.

### State conventions (referenced in specs)

`GameContext.tsx` is the **single source of truth** for all runtime app state.

```typescript
// src/context/GameContext.tsx — current AppState shape
interface AppState {
  settings: GlobalSettings;     // loaded from /api/settings
  teams: TeamState;             // team members + points (persisted to localStorage)
  settingsLoaded: boolean;
  currentGame: CurrentGame | null;
}
```

When a spec requires new state, extend `AppState` in this order:
1. Add type to `src/types/game.ts` or `src/types/config.ts`
2. Add field to `AppState`
3. Add `Action` union member
4. Handle in `reducer` (sync localStorage inside reducer, not in components)
5. Initialize in `getInitialState`

**State anti-patterns:**
- **Never** write directly to `localStorage` from a component
- **Never** store derived values — compute them from raw state at read time
- **Never** create a second React Context for app state

---

## 4. Game File Conventions

### Single-instance game
```json
// games/trump-oder-hitler.json
{ "type": "simple-quiz", "title": "...", "questions": [...] }
```
Referenced in `gameOrder` as `"trump-oder-hitler"`.

### Multi-instance game
```json
// games/allgemeinwissen.json
{
  "type": "simple-quiz",
  "title": "Allgemeinwissen",
  "instances": {
    "v1": { "questions": [...] },
    "v2": { "title": "Allgemeinwissen v2", "questions": [...] }
  }
}
```
Referenced as `"allgemeinwissen/v1"`. Instance fields override base fields.

**Rules:**
- Content language: **German** — questions, answers, rules, button labels
- Point value = `currentIndex + 1` (positional). Never hardcode a number
- Files prefixed `_template-` are excluded from validation — do not reference in `gameOrder`
- Run `npm run validate` after any change to a game file or `config.json`
- `config.json` is encrypted with git-crypt — never commit unencrypted

---

## 5. Game Types Reference

| Type | Questions source | Points awarded by |
|------|-----------------|-------------------|
| `simple-quiz` | JSON `questions[]` | `AwardPoints` (host picks winner) |
| `bet-quiz` | JSON `questions[]` (with `category`) | Inline per-question (±bet, one team per question) |
| `guessing-game` | JSON `questions[]` | `AwardPoints` |
| `q1` | JSON `questions[]` (3 true + 1 false) | `AwardPoints` |
| `four-statements` | JSON `questions[]` (up to 4 clues → text/image answer) | `AwardPoints` |
| `fact-or-fake` | JSON `questions[]` | `AwardPoints` |
| `audio-guess` | JSON `questions[]` | `AwardPoints` |
| `video-guess` | JSON `questions[]` | `AwardPoints` |
| `quizjagd` | JSON `{ easy, medium, hard }` | Inline per-question (can be negative) |
| `final-quiz` | JSON `questions[]`, teams bet | Inline per-question, per team |
| `bandle` | JSON `questions[]` with `tracks[]` | `AwardPoints` (host picks winner) |
| `image-guess` | JSON `questions[]` | `AwardPoints` (host picks winner) |

---

## 6. How to Add a New Game Type

> **Detailed workflow:** `skills/add-gametype/SKILL.md` — use `/add-gametype` in Claude Code, or read the file directly in GitHub Copilot Chat. Follow it step by step; do not skip the spec phase.

The mandatory sequence: **Spec → Types → Implementation → Tests → Verify**

1. **Spec** — write `specs/games/<type>.md` and confirm with the user before writing any code
2. **Types** — add question interface, config interface extending `BaseGameConfig`, add to `GameType` union and `GameConfig` union in `src/types/config.ts`
3. **Component** — `src/components/games/MyGame.tsx`, must wrap in `<BaseGameWrapper>`; call `onGameComplete()` when done
4. **Register** — add `case 'my-type':` in `src/components/games/GameFactory.tsx`
5. **Server** — only needed if questions come from filesystem; add builder in `server/index.ts`
6. **Validator** — add to `VALID_GAME_TYPES` in `validate-config.ts`
7. **Template** — create `games/_template-my-type.json`
8. **Docs** — add section to `GAME_TYPES.md`; update §5 table in this file
9. **Tests** — add `tests/unit/games/MyGame.test.tsx` following existing patterns. Also add `tests/e2e/frontend/games/<my-type>.spec.ts` (stubbed with `test.fixme` at minimum) so the grep-for-coverage property holds
10. **API contracts** — if the new game type introduces a new server endpoint (unusual) or a new payload shape, add its schema to `specs/api/openapi.yaml` under `components/schemas/` and add the new type to `GameType` enum and `GameConfig` discriminator. Run `npm run contracts:lint` — it must pass
11. **Verify** — run `npm run validate`, `npm test`, and `npm run contracts:lint` (new game types modify shared types in `src/types/config.ts` and `GameFactory.tsx` — full suite required); all must pass

---

## How to Add a New Joker

> **Detailed workflow:** `skills/add-joker/SKILL.md` — use `/add-joker` in Claude Code.

Adding a joker is a small, catalog-only change: append a `{ id, name, description, icon }` entry to `JOKER_CATALOG` in [src/data/jokers.ts](src/data/jokers.ts) and run the verification steps. Icons are emoji-only. Joker effects are resolved manually by the gamemaster — never add effect logic. See [specs/jokers.md](specs/jokers.md) for the full design.

---

## 7. Development Conventions

| Area | Rule |
|------|------|
| Types | All game config types in `src/types/config.ts`. Never create parallel type files for configs |
| State | All mutations via `dispatch()`. localStorage sync happens only inside `reducer` |
| Components | Every game component must use `BaseGameWrapper` — it owns phase transitions |
| Server | Re-reads `config.json` on every request — this is intentional, do not cache it |
| UI text | German only — no English strings in player-facing UI |
| Imports | Use `type` imports: `import type { Foo } from '...'` |
| Specs | Read relevant specs before every task. Update the spec immediately whenever implementation diverges, new behaviour is added, or any acceptance criterion changes. Never finish a task with a spec that doesn't match what was built |
| API contracts | Every change to an HTTP route or WebSocket channel MUST update [specs/api/openapi.yaml](specs/api/openapi.yaml) and/or [specs/api/asyncapi.yaml](specs/api/asyncapi.yaml) in the same commit. Zone changes also update the relevant [docs/replace-*.md](docs/) guide. Run `npm run contracts:lint` + `npm run test:contracts` before declaring done. See §2a above |
| Testing | **Default — related tests only:** after changing source files, run `npm run test:related -- <paths of changed files>` (vitest `--related` runs every test whose import graph reaches the changed code). **Escalate to full suite (`npm test`) only when shared code changes:** `src/types/config.ts`, `src/types/game.ts`, `src/context/GameContext.tsx`, `src/components/games/BaseGameWrapper.tsx`, `src/components/games/GameFactory.tsx`, `src/components/common/AwardPoints.tsx`, `src/services/api.ts`, `server/index.ts`, `server/ws.ts`, `server/whisper-jobs.ts`, or `validate-config.ts`. All selected tests must pass before a task is done. When adding a new feature: write tests covering the new behaviour. When changing existing code: update any tests that cover the changed behaviour so they reflect the new reality — never delete or disable a test to make the suite pass. If a test fails after a change, either fix the code or update the test, but never ignore it |
| Responsive | Every frontend change must be responsive. Use `clamp()` for font-sizes/padding, CSS Grid or flexbox with responsive rules, and media queries aligned to the breakpoint system (576/768/1024/1400px). Never use fixed widths without a responsive fallback. The admin uses a hamburger off-canvas drawer below 1024px; the gameshow uses fluid typography |
| Frontend verification | After any frontend change (`.tsx`, `.css`, UI text), use Playwright MCP to take screenshots at **375px** (phone), **768px** (tablet), **1024px** (laptop), and **1920px** (projector) to verify the change is responsive and visually correct at all sizes |
| JSON trailing newline | Every JSON file must end with a trailing `\n`. When using Write: `content` must end with `\n`. When using Edit: never let an edit strip the final newline. Verify after every JSON edit. |
| Theme showcase | When adding a new frontend or admin UI component (button variant, card, status indicator, game element), add a representative example to [`src/components/screens/ThemeShowcase.tsx`](src/components/screens/ThemeShowcase.tsx) so all themes can be verified at `/theme-showcase`. Frontend components go in `FrontendShowcase`, admin components in `AdminShowcase`. Show text on its actual background (glass card, quiz container, etc.) |
| Docs | Top-level docs must stay in sync with the code. Whenever a task adds/renames/removes a game type, API endpoint, `AppState` field, or major feature, update every affected doc in the same task: `AGENTS.md` (esp. §5 game types table, §2 critical files + endpoints), `README.md`, `MODULAR_SYSTEM.md`, `GAME_TYPES.md`, `QUICK_START.md`, `docs/admin-guide.md`, and `specs/README.md`. **A task is not done if a doc it affects is out of date.** |

---

## CSS / Styling

When fixing CSS issues, always check for global styles (e.g., global margin-top on buttons) that may cascade into unrelated components. Trace specificity chains before applying narrow fixes.

---

## Workflow

When implementing UI changes, verify the fix visually using Playwright browser tools BEFORE reporting completion. Do not assume CSS changes work — take a screenshot to confirm.

---

## Debugging

When a first fix attempt fails or the user pushes back, step back and re-examine root cause from scratch rather than iterating on the same wrong approach. Consider simpler explanations first (e.g., box-shadow, not backdrop-filter).

---

## 8. What NOT to Do

- **Don't** write directly to `localStorage` from a component
- **Don't** bypass `BaseGameWrapper` in a game component
- **Don't** hardcode point values — always use `currentIndex + 1`
- **Don't** add a `"games"` key to `config.json` (old format, rejected by validator)
- **Don't** reference `_template-` files in `gameOrder`
- **Don't** skip `npm run validate` after config changes
- **Don't** use English for player-facing text
- **Don't** store derived state — compute it from raw state at read time
- **Don't** commit `config.json` if git-crypt is not active
- **Don't** start any task — including changes to existing features — without first reading the relevant spec(s)
- **Don't** finish any task if the spec no longer accurately describes what was built — update the spec as part of the task
- **Don't** finish any task with a failing test — all tests must pass before done
- **Don't** delete or skip tests to make the suite green — fix the code or update the test to match the new intended behaviour
- **Don't** run the full suite when only related tests are needed — use `npm run test:related -- <files>` for targeted changes. Reserve `npm test` for changes to the shared-code list in §7 Testing
- **Don't** add frontend changes that only work at one screen size — every `.tsx`/`.css` change must be verified responsive at 375px, 768px, 1024px, and 1920px
- **Don't** add a new frontend or admin UI component without adding it to the Theme Showcase (`src/components/screens/ThemeShowcase.tsx`) — every visual element must be verifiable across all themes at `/theme-showcase`
- **Don't** leave docs out of date — whenever you add/rename/remove a game type, API endpoint, `AppState` field, or major feature, update every doc that mentions it in the same task (`AGENTS.md` §5 table, `README.md`, `MODULAR_SYSTEM.md`, `GAME_TYPES.md`, `QUICK_START.md`, `docs/admin-guide.md`, `specs/README.md`)
- **Don't** add or change a route in `server/index.ts` without updating `specs/api/openapi.yaml` in the same commit. If the route moves between zones (frontend/admin/gamemaster/shared), also update the relevant `docs/replace-*.md` guide.
- **Don't** add or change a WebSocket channel in `server/ws.ts` without updating `specs/api/asyncapi.yaml` in the same commit.
- **Don't** finish a contract-touching task without running `npm run contracts:lint` — a drift-free spec is only a drift-free spec if the linter has seen it.

---

*Update this file whenever new game types, architectural patterns, or spec conventions are added.*
