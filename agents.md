# agents.md — AI Development Guide

This file is for AI coding assistants (Claude Code, GitHub Copilot) working on this codebase.
Read it before making changes. Keep it updated as the project evolves.

> **For Claude Code:** this file is project context.
> **For GitHub Copilot:** keep this file open when working on state or game logic — the examples directly inform completions.

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
4. `GAME_TYPES.md` — all 8 game types with config examples

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

### API endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/settings` | `SettingsResponse` |
| `GET /api/game/:index` | `GameDataResponse` |
| `GET /api/background-music` | `string[]` of MP3 filenames |
| `GET /api/music-subfolders` | `string[]` of subdirs in `audio-guess/` |

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

1. **Before starting:** read the spec in `specs/`. If none exists for the task, write one and confirm with the user before proceeding.
2. **During implementation:** tick off acceptance criteria as they are met.
3. **After implementation:** verify every criterion is met — by running tests, manually testing in `npm run dev`, or both.
4. **Update the spec** if scope changes during implementation (don't silently diverge).

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
| `audio-guess` | Filesystem `audio-guess/<folder>/` | `AwardPoints` |
| `image-game` | Filesystem `image-guess/` | `AwardPoints` |
| `quizjagd` | JSON `{ easy, medium, hard }` | Inline per-question (can be negative) |
| `final-quiz` | JSON `questions[]`, teams bet | Inline per-question, per team |

---

## 6. How to Add a New Game Type

1. **Types** — add question interface, config interface extending `BaseGameConfig`, add to `GameType` union and `GameConfig` union in `src/types/config.ts`
2. **Component** — `src/components/games/MyGame.tsx`, must wrap in `<BaseGameWrapper>`; call `onGameComplete()` when done
3. **Register** — add `case 'my-type':` in `src/components/games/GameFactory.tsx`
4. **Server** — only needed if questions come from filesystem; add builder in `server/index.ts`
5. **Validator** — add to `VALID_GAME_TYPES` in `validate-config.ts`
6. **Template** — create `games/_template-my-type.json`
7. **Docs** — add section to `GAME_TYPES.md`
8. **Tests** — add `tests/unit/games/MyGame.test.tsx` following existing patterns

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
| Testing | Run `npm test` after non-trivial changes; `npm run test:e2e` for full flow changes |

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

---

*Update this file whenever new game types, architectural patterns, or spec conventions are added.*
