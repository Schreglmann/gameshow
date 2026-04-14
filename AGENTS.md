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
| `src/services/api.ts` | Typed fetch wrappers for all API endpoints |
| `games/*.json` | Individual game definitions (33+ files) |
| `config.json` | Active gameshow selector + all gameshow definitions (encrypted) |
| `config.template.json` | Safe template for new configs |
| `specs/admin-backend.md` | Spec for the `/admin` backend CMS (games, assets, config, system status) |

### API endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/settings` | `SettingsResponse` |
| `GET /api/game/:index` | `GameDataResponse` |
| `GET /api/background-music` | `string[]` of MP3 filenames |

Admin CMS endpoints live under `/api/backend/*` (games, assets, config, system status, gamemaster controls, clean-install) — see [specs/admin-backend.md](specs/admin-backend.md) for the full surface. A websocket layer for gamemaster controls and backend events lives in [server/ws.ts](server/ws.ts).

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
| `guessing-game` | JSON `questions[]` | `AwardPoints` |
| `four-statements` | JSON `questions[]` | `AwardPoints` |
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
9. **Tests** — add `tests/unit/games/MyGame.test.tsx` following existing patterns
10. **Verify** — run `npm run validate` then `npm test`; all must pass

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
| Testing | Run `npm test` after **every** implementation — no exceptions. All tests must pass before a task is considered done. When adding a new feature: write tests covering the new behaviour. When changing existing code: update any tests that cover the changed behaviour so they reflect the new reality — never delete or disable a test to make the suite pass. If a test fails after a change, either fix the code or update the test, but never ignore it |
| Responsive | Every frontend change must be responsive. Use `clamp()` for font-sizes/padding, CSS Grid or flexbox with responsive rules, and media queries aligned to the breakpoint system (576/768/1024/1400px). Never use fixed widths without a responsive fallback. The admin uses a hamburger off-canvas drawer below 1024px; the gameshow uses fluid typography |
| Frontend verification | After any frontend change (`.tsx`, `.css`, UI text), use Playwright MCP to take screenshots at **375px** (phone), **768px** (tablet), **1024px** (laptop), and **1920px** (projector) to verify the change is responsive and visually correct at all sizes |
| JSON trailing newline | Every JSON file must end with a trailing `\n`. When using Write: `content` must end with `\n`. When using Edit: never let an edit strip the final newline. Verify after every JSON edit. |
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
- **Don't** add frontend changes that only work at one screen size — every `.tsx`/`.css` change must be verified responsive at 375px, 768px, 1024px, and 1920px
- **Don't** leave docs out of date — whenever you add/rename/remove a game type, API endpoint, `AppState` field, or major feature, update every doc that mentions it in the same task (`AGENTS.md` §5 table, `README.md`, `MODULAR_SYSTEM.md`, `GAME_TYPES.md`, `QUICK_START.md`, `docs/admin-guide.md`, `specs/README.md`)

---

*Update this file whenever new game types, architectural patterns, or spec conventions are added.*
