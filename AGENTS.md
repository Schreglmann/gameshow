# AGENTS.md — AI Development Guide

This file is for AI coding assistants (Claude Code, GitHub Copilot) working on this codebase.
Read it before making changes. Keep it updated as the project evolves.

> **For Claude Code:** this file is project context.
> **For GitHub Copilot:** keep this file open when working on state or game logic — the examples directly inform completions.

---

## 1. Project Orientation

Config-driven, modular gameshow web app with admin CMS, DAM (Digital Asset Manager), and WebSocket push architecture. Entirely AI-generated, run at live in-person events. Two teams compete across multiple game rounds. All player-facing content is in **German**.

**Tech stack:** React 19 · React Router 7 · Express · TypeScript · Vite · Vitest · Playwright

**Key commands:**
```bash
npm run dev        # dev mode (hot reload client + server)
npm run typecheck  # tsc over client + server configs (runs in CI + pre-commit)
npm run lint       # eslint — typescript-eslint + react-hooks (runs in CI + pre-commit)
npm run validate   # validate config.json + all game files — run after any config change
npm run validate-assets  # check every game's asset references exist in local-assets/ (read-only, exits 0)
npm test           # unit + integration tests
npm run test:e2e   # Playwright end-to-end
npm run fixtures   # generate example games ("Beispiele") + synthesized media (see specs/example-games.md)
```

**Start reading here:**
1. `src/types/config.ts` — all TypeScript types (source of truth)
2. `src/context/GameContext.tsx` — all app state
3. `MODULAR_SYSTEM.md` — architecture and config structure
4. `GAME_TYPES.md` — all game types with config examples

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
| `server/nas-reachability.ts` | Freeze-proof NAS access: non-blocking cached `isNasReachable()` flag + bounded async wrappers (`nasStat`/`nasPathExists`). A stale network mount makes sync `stat`/`read` block uninterruptibly in the kernel (once froze the whole event loop). **NEVER do synchronous NAS I/O** — route every NAS touch through this module or async `fs/promises` — see [specs/nas-freeze-resilience.md](specs/nas-freeze-resilience.md) |
| `server/nas-sync-conflicts.ts` | Sidecar (`local-assets/.nas-sync-conflicts.json`) recording deletions the sync safety layers refused (Layer 2 loss-ratio veto + Layer 3 bulk-cap). Reconciled each sync run (self-healing), surfaced in the admin System-tab "NAS-Sync-Konflikte" card, resolved via `/api/backend/nas-sync-conflicts*` (restore or confirm-delete) — see [specs/nas-sync-conflicts.md](specs/nas-sync-conflicts.md) |
| `server/asset-alias-map.ts` | Persistent map (`images/.asset-aliases.json`) consulted by auto-cover/poster downloaders so DAM merges aren't undone on the next fetch — see [specs/asset-merge.md](specs/asset-merge.md) |
| `server/audio-cover-meta.ts` | Sidecar recording the provenance of every audio cover (`youtube`/`itunes`/`musicbrainz`/`manual`/`auto`); backs the DAM source pill + override / iTunes-swap endpoints — see [specs/audio-cover-override.md](specs/audio-cover-override.md) |
| `server/color-profile.ts` | Sidecar cache of extracted color slices for the `colorguess` game type; warmed on upload, lazy-extracted on read — see [specs/games/colorguess.md](specs/games/colorguess.md) |
| `server/content-watch.ts` | Watches config.json / theme-settings.json / games/*.json and broadcasts the `content-changed` WS channel so the live frontend re-fetches without a reload — see [specs/live-config-reload.md](specs/live-config-reload.md) |
| `server/upscale.ts` | Local-AI image upscaler (`upscayl-ncnn` / Real-ESRGAN, one job at a time, Sharp post-pass); backs admin's "AI hochskalieren" tab. Install: `npm run upscaler:install` — see [specs/dam-image-upscale.md](specs/dam-image-upscale.md) |
| `server/spellcheck.ts` + `server/spellcheck-allowlist.ts` | German/English spell + grammar check (admin **Korrektur** tab) proxying LanguageTool: one batched `de-DE` pass, then flagged tokens re-checked in `en-US` to drop English false-positives. Persisted response cache, sliding-window rate limiter, `spellcheck-allowlist.json` sidecar (on/off flag, `skipNames`, allowed words, ignored fingerprints). Routes under `/api/backend/spellcheck/*` — full algorithm + client modules in [specs/spellcheck.md](specs/spellcheck.md) |
| `server/languagetool-docker.ts` | Admin-managed local LanguageTool Docker container (`gameshow-languagetool`, port 8010); while healthy the checker routes to it and bypasses the rate limiter — see [specs/languagetool-docker.md](specs/languagetool-docker.md) |
| `server/yt-dlp.ts` + `server/youtube-search.ts` | `yt-dlp.ts` owns the auto-downloaded `yt-dlp` binary (shared by download + search flows); `youtube-search.ts` backs `POST /api/backend/assets/youtube/search` and the DAM YouTube modal's "Suchen" tab — see [specs/youtube-search.md](specs/youtube-search.md) |
| `scripts/generate-laendergrenzen-maps.ts` | Country-map SVG generator (two countries highlighted, shared border in red, neighbors dimmed) — reusable for any future game needing country maps; the helper primitives (projection, clipping, labels) are standalone. Run `node --import=tsx scripts/generate-laendergrenzen-maps.ts`; repurpose by editing the `pairs` array + `OUT_DIR` |
| `src/services/api.ts` | Typed fetch wrappers for all API endpoints |
| `games/*.json` | Individual game definitions (encrypted). Generated `games/beispiel-*.json` (the "Beispiele") are gitignored — never committed |
| `config.json` | Active gameshow selector + all gameshow definitions (encrypted) |
| `server/example-games.ts` | `EXAMPLE_GAMES` fixtures (one real example game per type, except video-guess) + `materializeExamples()`; backs the admin "Beispiele erstellen" button and `npm run fixtures`. Media synthesized by `server/example-media.ts` — see [specs/example-games.md](specs/example-games.md) |
| `specs/admin-backend.md` | Spec for the `/admin` backend CMS (games, assets, config, system status) |
| `specs/rules-standard.md` | Canonical phrasing library for every game's `rules` array. Read before editing or adding rules — never invent new phrasing for mechanics already covered there |
| `specs/rules-presets.md` | Shared rule presets: games may set `rulesPreset` referencing `config.json.rulesPresets`; the server merges it at runtime, admin renders preset buttons in `RulesEditor` |
| `src/utils/rulesPreset.ts` | Shared preset resolver + `PLACEHOLDER_TASK_LINE`, used by both server (`loadGameConfig`) and admin client |
| `src/data/jokers.ts` | Hardcoded joker catalog (`JOKER_CATALOG`) — add new entries via the `add-joker` skill |
| `src/components/common/TeamJokers.tsx` + `JokerIcon.tsx` | Per-team joker UI rendered in the `Header` (stroke-SVG icons — no emoji) — see [specs/jokers.md](specs/jokers.md) |
| `src/entries/{frontend,admin,gamemaster}.tsx` | Three separate React entry points, one per installable PWA (see [specs/pwa.md](specs/pwa.md)) |
| `vite.config.{frontend,admin,gamemaster,dev,shared}.ts` | Per-PWA Vite build configs plus the dev-server multi-entry config |
| `{show,admin,gamemaster}/index.html` | HTML entries for the three PWAs, each with its own manifest; root `/` redirects to `/show/`, scopes are disjoint so all three install separately (see [specs/pwa.md](specs/pwa.md)) |
| `src/hooks/useInstallPrompt.ts` + `src/components/common/InstallButton.tsx` | Cross-browser PWA install button (Chromium native prompt, Safari/Firefox manual-install popover) |
| `src/utils/safePlay.ts` + `src/utils/mediaLoadTimeout.ts` + `src/hooks/usePreloadAsset.ts` + `src/hooks/useGmConnected.ts` + `src/components/common/RetryImage.tsx` + `src/components/common/AssetReloadButton.tsx` | Asset-resilience primitives for audio/video games: `safePlay()` (play with retry + muted-autoplay fallback), `watchMediaLoad()` (slow-load watchdog), `usePreloadAsset` (prefetch via `fetch()` — **never** `new Audio()`/`new Image()`, which leak keep-alive connections and saturate Firefox's 6-per-origin limit), `<RetryImage>`, `useGmConnected()`, `<AssetReloadButton>`. Born from a live-show bug — see [specs/asset-resilience.md](specs/asset-resilience.md) |
| `specs/api/openapi.yaml` | OpenAPI 3.1 for every HTTP route — formal contract for the show/admin/gamemaster PWAs |
| `specs/api/asyncapi.yaml` | AsyncAPI 3.1 for every WebSocket channel at `/api/ws` |
| `specs/api/inventory.md` | Human-readable catalog of every route + channel; source of truth for the YAMLs |
| `docs/replace-frontend.md` / `docs/replace-admin.md` / `docs/replace-gamemaster.md` | Per-zone drop-in replacement guides — which endpoints + channels a replacement PWA must speak |
| `tests/contracts/` | vitest suite validating live server responses against `openapi.yaml` / `asyncapi.yaml` |

### API endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/settings` | `SettingsResponse` |
| `GET /api/game/:index` | `GameDataResponse` |
| `GET /api/background-music` | `string[]` of MP3 filenames |

Every route and channel is documented in [specs/api/openapi.yaml](specs/api/openapi.yaml) (HTTP) and [specs/api/asyncapi.yaml](specs/api/asyncapi.yaml) (WebSocket), grouped by zone — see [specs/api/README.md](specs/api/README.md) for the overview.

Admin CMS endpoints live under `/api/backend/*` — see [specs/admin-backend.md](specs/admin-backend.md). The WebSocket layer for gamemaster controls and backend events lives in [server/ws.ts](server/ws.ts). Per-video Whisper transcription jobs live under `/api/backend/assets/videos/whisper/*` ([server/whisper-jobs.ts](server/whisper-jobs.ts), setup `npm run whisper:install && npm run whisper:download-model`) — see [specs/whisper-transcription.md](specs/whisper-transcription.md).

---

## 2a. API contracts (first-class discipline)

The three PWAs (show / admin / gamemaster) are physically separate bundles that talk to the backend only via HTTP `/api/*` and WebSocket `/api/ws` — each is drop-in replaceable, but only because the contract is formally documented.

**The rule:** every change to an HTTP route or WebSocket channel MUST update the contract docs in the same commit. **A task is not done if the contract docs don't match the code.**

- Route added/removed/renamed/reshaped → update [specs/api/openapi.yaml](specs/api/openapi.yaml).
- WebSocket channel changed → update [specs/api/asyncapi.yaml](specs/api/asyncapi.yaml) + [server/ws.ts](server/ws.ts) top-comment.
- Zone changes (either kind) → also update [specs/api/inventory.md](specs/api/inventory.md), the OpenAPI tag, and the relevant [docs/replace-*.md](docs/) guide.

```bash
npm run contracts:lint      # redocly + asyncapi validation — must pass with zero errors
npm run test:contracts      # vitest: live server responses validated against schemas
```

`test:contracts` auto-skips when no dev server is running (safe in CI); for real local verification run `npm run dev` in one terminal and `npm run test:contracts` in another. Full discipline + rationale: [specs/api/README.md](specs/api/README.md).

---

## 3. Spec-Driven Development

**The rule:** write a spec before writing any code. The spec defines *what* to build; implementation follows from it.

### The mandatory sequence

```
Spec → Types → Implementation → Tests → Verify against spec
```

All feature specs live in [`specs/`](specs/) — see [`specs/README.md`](specs/README.md) for the full index, the spec template, and how to write a new one.

### Spec workflow for AI agents

**Every task — new feature or change to existing code — follows this workflow without exception.**

1. **Before starting:** read every spec relevant to the task. If none exists, write one (template in `specs/README.md`) and confirm with the user before proceeding. If one exists but is outdated, update it before writing any code.
2. **During implementation:** tick off acceptance criteria as they are met. If the implementation must deviate from the spec, update the spec first — never silently diverge.
3. **After implementation:** verify every criterion is met — by running tests, manually testing in `npm run dev`, or both.
4. **Keep the spec current:** any behaviour, state shape, API contract, or UI change not in the original spec must be added to it before the task is done. The spec must always match reality.

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
- **Never** write directly to `localStorage` from a component — gameplay state goes through the reducer. **Documented exception:** device-local UI flags (GM lock / answer visibility in [GamemasterScreen.tsx](src/components/screens/GamemasterScreen.tsx) + [useGamemasterSync.ts](src/hooks/useGamemasterSync.ts), theme selection in `ThemeContext`) persist directly — they are per-device UI state, not show state
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
- Type-level examples live in code, not files: `server/example-games.ts` (`EXAMPLE_GAMES`) defines one real example game per type, generated on demand as gitignored `games/beispiel-*.json` — see [specs/example-games.md](specs/example-games.md)
- Run `npm run validate` after any change to a game file or `config.json`
- `config.json` is encrypted with git-crypt — never commit unencrypted
- **`info` field on simple-quiz / bet-quiz questions is rendered as a subtitle ABOVE the question — visible during the question phase, not just on answer reveal.** Treat it as part of the question, never as answer-phase trivia. Do not use `info` for anything that names the answer, gives etymological hints, lists the answer in another language, or otherwise lets a player skip thinking. If the answer-image already gives the answer away (maps, photos, etc.), prefer to omit `info` entirely.

---

## 5. Game Types Reference

Full field semantics + config examples for every type: [GAME_TYPES.md](GAME_TYPES.md).

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
| `bandle` | JSON `questions[]` with `tracks[]` | `AwardPoints` |
| `image-guess` | JSON `questions[]` | `AwardPoints` |
| `colorguess` | JSON `questions[]` (image + answer; colors auto-extracted server-side) | `AwardPoints` |
| `ranking` | JSON `questions[]` (ordered `answers[]`, progressive reveal; optional `answerAudio` + trigger, optional shuffled `items[]` candidate pool) | `AwardPoints` |
| `wer-kennt-mehr` | JSON `questions[]` (question + example `answer`/`answerList`) | `scoringMode`: `standard` (default — positional points at game end), `count` (inline, higher count wins, tie splits), `count-penalty` (loser also loses the count, floored at 0) |
| `random-frame` | JSON `questions[]` (video + answer; random still frame extracted at runtime via `GET /api/random-frame`, black frames skipped; GM can re-roll, admin prerenders fallback frames) | `AwardPoints` — see [specs/games/random-frame.md](specs/games/random-frame.md) |

---

## 6. How to Add a New Game Type

> **Detailed workflow:** [skills/add-gametype/SKILL.md](skills/add-gametype/SKILL.md) — use `/add-gametype` in Claude Code, or read the file directly in GitHub Copilot Chat. Follow it step by step; do not skip the spec phase.

The mandatory sequence: **Spec → Types → Implementation → Tests → Verify**

1. **Spec** — write `specs/games/<type>.md`, confirm with the user before any code
2. **Types** — question + config interfaces in `src/types/config.ts`; extend `GameType` and `GameConfig` unions
3. **Component** — `src/components/games/MyGame.tsx`, wrapped in `<BaseGameWrapper>`; call `onGameComplete()` when done
4. **Register** — add `case 'my-type':` in `GameFactory.tsx`
5. **Server** — only if questions come from the filesystem; add builder in `server/index.ts`
6. **Validator** — add to `VALID_GAME_TYPES` in `validate-config.ts`; admin needs the type added in `GamesTab.tsx` + `GameEditor.tsx` + `gameTypeInfo.ts` (see skill)
7. **Example fixture** — add to `EXAMPLE_GAMES` in `server/example-games.ts`, with `rules` built from the archetypes in [specs/rules-standard.md](specs/rules-standard.md) (verbatim — never composed from scratch)
8. **Docs** — add section to `GAME_TYPES.md`; update the §5 table in this file
9. **Tests** — `tests/unit/games/MyGame.test.tsx` + e2e stub `tests/e2e/frontend/games/<my-type>.spec.ts` (`test.fixme` at minimum, so the grep-for-coverage property holds)
10. **API contracts** — add the config schema to `specs/api/openapi.yaml` (`GameType` enum + `GameConfig` discriminator)
11. **Verify** — `npm run validate`, `npm test` (shared types changed → full suite), `npm run contracts:lint` — all must pass

---

## How to Add a New Joker

> **Detailed workflow:** `skills/add-joker/SKILL.md` — use `/add-joker` in Claude Code.

Adding a joker is a small, catalog-only change: append a `{ id, name, description }` entry to `JOKER_CATALOG` in [src/data/jokers.ts](src/data/jokers.ts) and add its stroke-SVG icon in `JokerIcon.tsx` (no emoji). Joker effects are resolved manually by the gamemaster — never add effect logic. See [specs/jokers.md](specs/jokers.md) for the full design.

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
| Media URLs | Never interpolate a raw asset path into a media `src` (or `new Audio()` / `fetch()`) — filenames with `#`/`?`/`&` silently break the request. Build the src via `toMediaSrc()` / `assetUrl()` / `encodeAssetPath()` from [src/utils/assetUrl.ts](src/utils/assetUrl.ts). Config stores **raw** logical paths — encode only at the DOM `src` boundary, never the stored value |
| File exploration | **Never** use `find`, `ls`, `cat`, `head`, or `tail` via Bash for local files — use `Read` / `Glob` / `Grep` (Bash triggers permission prompts). Reserve Bash for git, npm, scripts, and other shell-only operations |
| Specs | Read relevant specs before every task. Update the spec immediately whenever implementation diverges. Never finish a task with a spec that doesn't match what was built |
| API contracts | Every route/channel change updates [specs/api/openapi.yaml](specs/api/openapi.yaml) / [specs/api/asyncapi.yaml](specs/api/asyncapi.yaml) in the same commit; zone changes also update the relevant [docs/replace-*.md](docs/) guide. Run `npm run contracts:lint` + `npm run test:contracts` before declaring done. See §2a |
| Testing | **Default:** `npm run test:related -- <changed files>` (vitest `--related`). **Full suite (`npm test`) only when shared code changes:** `src/types/config.ts`, `src/types/game.ts`, `GameContext.tsx`, `BaseGameWrapper.tsx`, `GameFactory.tsx`, `AwardPoints.tsx`, `src/services/api.ts`, `server/index.ts`, `server/ws.ts`, `server/whisper-jobs.ts`, `validate-config.ts`. New features get new tests; changed behaviour gets updated tests — never delete or disable a test to make the suite pass. All selected tests must pass before a task is done |
| Responsive | Every frontend change must be responsive: `clamp()` for font-sizes/padding, Grid/flexbox, media queries on the 576/768/1024/1400px breakpoints. Never fixed widths without a fallback. Admin uses a hamburger drawer below 1024px; the show uses fluid typography |
| Frontend verification | After any frontend change (`.tsx`, `.css`, UI text), verify visually with Playwright screenshots at **375px**, **768px**, **1024px**, and **1920px** BEFORE reporting completion — never assume CSS changes work. Screenshots used for decisions (comparing variants, confirming a direction) must be saved as PNGs in the project root (gitignored), not just shown in chat |
| CSS debugging | Check for global styles that cascade into unrelated components; trace specificity chains before applying narrow fixes. When a first fix fails or the user pushes back, re-examine root cause from scratch — consider simpler explanations first (e.g. box-shadow, not backdrop-filter) |
| JSON trailing newline | Every JSON file must end with a trailing `\n`. Never let a Write/Edit strip the final newline — verify after every JSON edit |
| Image filenames (people) | Name person images `Vorname Nachname.<ext>` — full name, real spaces, proper case. `Matthew Mercer.jpg`, not `mercer.jpg` or `matthew-mercer.jpg` |
| Rules phrasing | Every game's `rules` array must follow the canonical archetypes in [specs/rules-standard.md](specs/rules-standard.md), reused verbatim — task line first, mechanic lines second. A genuinely new mechanic becomes a new Archetype X entry in the spec in the same commit |
| Theme showcase | Every new frontend/admin UI component gets a representative example in [src/components/screens/ThemeShowcase.tsx](src/components/screens/ThemeShowcase.tsx) (`FrontendShowcase` / `AdminShowcase`), on its actual background, so all themes are verifiable at `/theme-showcase` |
| Docs | Top-level docs must stay in sync with the code. Adding/renaming/removing a game type, API endpoint, `AppState` field, or major feature updates every affected doc in the same task: `AGENTS.md` (esp. §5 table, §2 critical files + endpoints), `README.md`, `MODULAR_SYSTEM.md`, `GAME_TYPES.md`, `QUICK_START.md`, `docs/admin-guide.md`, `specs/README.md`. **A task is not done if a doc it affects is out of date** |

---

## 8. What NOT to Do

Every rule in §7 also applies in the negative; this list only adds what §7 doesn't already say:

- **Don't** write directly to `localStorage` from a component (see §3 for the documented GM-zone UI-flag exception)
- **Don't** add a `"games"` key to `config.json` (old format, rejected by validator)
- **Don't** commit `config.json` if git-crypt is not active
- **Don't** bypass `BaseGameWrapper` in a game component
- **Don't** hardcode point values — always use `currentIndex + 1`
- **Don't** skip `npm run validate` after config changes
- **Don't** start any task without first reading the relevant spec(s), and don't finish one with a failing test or an out-of-date spec/doc/contract

---

*Update this file whenever new game types, architectural patterns, or spec conventions are added.*
