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
npm run validate-assets  # check every game's asset references exist in local-assets/ (read-only, exits 0)
npm test           # unit + integration tests
npm run test:e2e   # Playwright end-to-end
npm run fixtures   # generate example games ("Beispiele") + synthesized media (see specs/example-games.md)
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
| `server/audio-cover-meta.ts` | Sidecar (`images/.audio-cover-meta.json`) recording the provenance of every audio cover (`youtube` / `itunes` / `musicbrainz` / `manual` / `auto`); backs the source pill in the DAM audio preview and the override / iTunes-swap endpoints — see [specs/audio-cover-override.md](specs/audio-cover-override.md) |
| `server/color-profile.ts` | Sidecar cache (`images/.color-profiles.json`) of extracted color slices used by the `colorguess` game type; warmed on upload, lazy-extracted on read — see [specs/games/colorguess.md](specs/games/colorguess.md) |
| `server/content-watch.ts` | File watcher on config.json / theme-settings.json / games/*.json that broadcasts the `content-changed` WS channel so the live frontend re-fetches without a reload (settings, theme, current-game questions). Wired from `server/index.ts` after `setupWebSocket` — see [specs/live-config-reload.md](specs/live-config-reload.md) |
| `server/upscale.ts` | Local-AI image upscaler — spawns `upscayl-ncnn` (Real-ESRGAN) from `local-assets/.upscaler/<platform>-<arch>/upscayl-bin`, queues one job at a time, and returns the result through Sharp post-pass. Backs the "AI hochskalieren" tab in admin's `ReplaceImageModal`. Install via `npm run upscaler:install` — see [specs/dam-image-upscale.md](specs/dam-image-upscale.md). |
| `server/spellcheck.ts` + `server/spellcheck-allowlist.ts` | German/English spell + grammar check (admin tab labelled **Korrektur**, tab id `spellcheck`). `spellcheck.ts` proxies to LanguageTool (`LANGUAGETOOL_URL`, default public API; `LANGUAGETOOL_LANGUAGE`, default `auto`). **Auto pass-1 + en-US over flagged TOKENS** (`language=auto`): one cheap batched `auto` pass finds candidates (German truth for a German show), then every DISTINCT token flagged as a misspelling is re-checked — just the tokens, not the full fields — in `en-US`: a real German typo is foreign to English too so en-US flags it → kept; an English word ("love", "Knight") is valid English so en-US does NOT flag it → dropped. This strips English false-positives — whole English answers AND English words embedded in a German sentence (the old ratio-gated per-field pass missed the embedded case). Running `en-US` over the whole German show is avoided (it flags every word → very slow); checking only the handful of flagged tokens is cheap. Each German `/check` has a large fixed cost and the server serializes them, so request COUNT drives wall-clock: local/self-hosted packs much bigger chunks and the whole-show scan batches every game into one `/check`. **Spelling suppression is language-INDEPENDENT**: a spelling match is dropped when its token matches an allowed word OR the token of any spelling-type ignored fingerprint (`GERMAN_SPELLER_RULE` / `HUNSPELL_RULE` / `MORFOLOGIK_RULE_*`) — so a name ignored while a field was auto-detected as e.g. Italian stays ignored once it re-detects as German (grammar matches still match by exact fingerprint). Plus a per-field response cache **persisted to a gitignored `.spellcheck-cache.json`** sidecar (`version: 2`, bumped on `auto`-algorithm changes; survives server / `tsx watch` restarts; disabled under vitest) + a **sliding-window** rate limiter (public API only; burst up to ~18 req / ~70 KB per minute, only throttling once a window fills) + transient-failure retries + a global concurrency cap. Live throttle state is exposed via `GET /api/backend/spellcheck/rate-status` and surfaced as a banner in the scan UI. `spellcheck-allowlist.ts` is the repo-root `spellcheck-allowlist.json` sidecar holding the global on/off flag (default off), the **`skipNames`** flag (default **on** — capitalized spelling matches with no close LanguageTool correction are treated as proper names and suppressed; toggled via `POST /set-skip-names`), allowed words, and ignored-match fingerprints. Routes under `/api/backend/spellcheck/*`. Client: `SpellcheckSettingsContext` (global gate + skipNames), `LektoratTab` (whole-show scan; "Wörterbuch verwalten" opens the dictionary subpage), `SpellcheckDictionary` (the Wörterbuch subpage — see/add/edit/delete allowed words + ignored matches, name-skip toggle), `SpellCheckPanel` (report; suggestions **+ free-text "eigene Korrektur"** input), `SpellField`/`SpellCheckContext` (inline underlines; popover also has the free-text input), `src/utils/spellcheckFields.ts` (prose extractor) + `spellcheckFingerprint.ts` (shared fingerprint) + `spellcheckExplain.ts` (**always-German** issue explanation + rule-id decode for hover tooltips — LanguageTool's own `message` is localized to the detected language and is never shown) — see [specs/spellcheck.md](specs/spellcheck.md). |
| `server/languagetool-docker.ts` | Admin-managed **local LanguageTool Docker container** for the Korrektur tab. Spawns the `docker` CLI (fixed arg arrays, no shell) to pull/run/start/stop the `erikvl87/languagetool` container (`gameshow-languagetool`, port 8010); while it runs healthily it calls `setManagedLanguageToolUrl()` so the checker is routed at the local instance (rate limiter bypassed → fast cold scans). Phase machine `idle｜pulling｜starting｜running｜stopping｜error`; routes `GET/POST /api/backend/spellcheck/docker/{status,start,stop}`; `detectOnStartup()` re-routes after a server restart. Local-only (needs Docker on the host); test hooks `_setDockerRunner` / `_resetDockerState` — see [specs/languagetool-docker.md](specs/languagetool-docker.md). |
| `server/yt-dlp.ts` + `server/youtube-search.ts` | `yt-dlp.ts` owns the auto-downloaded `yt-dlp` binary (`YT_DLP_BIN`, `ensureYtDlp()`, JS-runtime args) shared by the download flow in [server/index.ts](server/index.ts) and the search flow. `youtube-search.ts` runs a metadata-only flat search (`ytsearchN:<q> --flat-playlist --dump-json`), normalises results, and caches each `(query, limit, page)` for 1h; pure `parseYtSearchOutput()` is unit-tested, the spawn is behind an injectable runner. Backs `POST /api/backend/assets/youtube/search` and the **"Suchen" tab** in the DAM YouTube modal (`AssetsTab` → `YouTubeSearchPanel`); a picked result downloads through the existing `youtube-download` route — see [specs/youtube-search.md](specs/youtube-search.md). |
| `scripts/generate-laendergrenzen-maps.ts` | Country-map SVG generator. Built for the Ländergrenzen game but **kept as the reusable starting point for any future game that needs country maps**. Renders two countries highlighted with their shared border drawn in red and surrounding countries dimmed; helper primitives (projection, Sutherland-Hodgman clip, antimeridian unwrap, pole-of-inaccessibility labels, archipelago bbox) are all standalone functions you can repurpose. Run from the repo root via `node --import=tsx scripts/generate-laendergrenzen-maps.ts`; for a different game, edit the `pairs` array and `OUT_DIR` (or copy the file). |
| `src/services/api.ts` | Typed fetch wrappers for all API endpoints |
| `games/*.json` | Individual game definitions (encrypted). Generated `games/beispiel-*.json` (the "Beispiele") are gitignored — never committed |
| `config.json` | Active gameshow selector + all gameshow definitions (encrypted) |
| `server/example-games.ts` | `EXAMPLE_GAMES` fixtures (one real example game per type, except video-guess) + `materializeExamples()`. Backs the admin "Beispiele erstellen" button (`POST /api/backend/games/examples`) and `npm run fixtures`. Media synthesized by `server/example-media.ts` (sharp images + ffmpeg PD-classical audio) — see [specs/example-games.md](specs/example-games.md) |
| `specs/admin-backend.md` | Spec for the `/admin` backend CMS (games, assets, config, system status) |
| `specs/rules-standard.md` | Canonical phrasing library for every game's `rules` array. Read before editing or adding rules — never invent new phrasing for mechanics already covered there. |
| `specs/rules-presets.md` | Shared rule presets. Games may set `rulesPreset` to reference a named entry in `config.json.rulesPresets`; the server merges it onto the per-game task line at runtime. Admin renders preset buttons in `RulesEditor`. |
| `src/utils/rulesPreset.ts` | Shared resolver + `PLACEHOLDER_TASK_LINE` constant used by both server (in `loadGameConfig`) and admin client. |
| `src/data/jokers.ts` | Hardcoded joker catalog (`JOKER_CATALOG`) — add new entries via the `add-joker` skill |
| `src/components/common/JokerBar.tsx` | Persistent per-team joker UI rendered inside `BaseGameWrapper` (see [specs/jokers.md](specs/jokers.md)) |
| `src/entries/{frontend,admin,gamemaster}.tsx` | Three separate React entry points, one per installable PWA (see [specs/pwa.md](specs/pwa.md)) |
| `vite.config.{frontend,admin,gamemaster,dev,shared}.ts` | Per-PWA Vite build configs plus the dev-server multi-entry config |
| `{show,admin,gamemaster}/index.html` | HTML entries for the three PWAs; each links its own `manifest.webmanifest`. Root `/` redirects to `/show/` — scopes are disjoint so all three PWAs install separately (see [specs/pwa.md](specs/pwa.md)) |
| `src/hooks/useInstallPrompt.ts` + `src/components/common/InstallButton.tsx` | Cross-browser PWA install button (Chromium native prompt, Safari/Firefox manual-install popover) |
| `src/utils/safePlay.ts` + `src/utils/mediaLoadTimeout.ts` + `src/hooks/usePreloadAsset.ts` + `src/hooks/useGmConnected.ts` + `src/components/common/RetryImage.tsx` + `src/components/common/AssetReloadButton.tsx` | Asset-resilience primitives shared by audio/video games. `safePlay()` wraps `HTMLMediaElement.play()` with retry + muted-autoplay fallback; `watchMediaLoad()` is a slow-load watchdog that flags assets which never fire `canplay`/`loadedmetadata`/`error` within a timeout (catches Firefox's hanging-fetch behavior); `usePreloadAsset` eagerly prefetches next-question audio + images via `fetch()` to warm the HTTP cache — **not** via `new Audio()` / `new Image()`, which leak keep-alive HTTP connections (an `<audio preload="auto">` holds its TCP slot while buffering, and across question advances those slots saturate Firefox's 6-per-origin limit and queue every subsequent audio request for minutes). The fetch runs without an `AbortSignal` so Firefox's coalesced preload + main-game fetch is never aborted; `<RetryImage>` is a drop-in `<img>` wrapper with retry, `?v={attempt}` cache-bust (only on retry), AND a slow-load timeout; `useGmConnected()` subscribes to the `gm-presence` WS channel; `<AssetReloadButton>` is the inline frontend fallback shown only when no GM is connected. Used by SimpleQuiz / AudioGuess / Bandle / VideoGuess after a live-show bug where transient network failures + Firefox request coalescing silently broke single questions for minutes — see [specs/asset-resilience.md](specs/asset-resilience.md). |
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
- Type-level examples live in code, not files: `server/example-games.ts` (`EXAMPLE_GAMES`) defines one real example game per type. They're generated on demand as `games/beispiel-*.json` (gitignored) via the admin "Beispiele erstellen" button or `npm run fixtures` — see [specs/example-games.md](specs/example-games.md)
- Run `npm run validate` after any change to a game file or `config.json`
- `config.json` is encrypted with git-crypt — never commit unencrypted
- **`info` field on simple-quiz / bet-quiz questions is rendered as a subtitle ABOVE the question — visible during the question phase, not just on answer reveal.** Treat it as part of the question, never as answer-phase trivia. Do not use `info` for anything that names the answer, gives etymological hints, lists the answer in another language, or otherwise lets a player skip thinking. If the answer-image already gives the answer away (maps, photos, etc.), prefer to omit `info` entirely.

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
| `colorguess` | JSON `questions[]` (image + answer; colors auto-extracted server-side) | `AwardPoints` (host picks winner) |
| `ranking` | JSON `questions[]` (question + ordered `answers[]`; progressive reveal) | `AwardPoints` (host picks winner) |
| `wer-kennt-mehr` | JSON `questions[]` (question + example `answer`/`answerList`) | Configurable `scoringMode`: `count` (default, final-game — inline; host enters higher count + winning team, tie splits) or `standard` (mid-game — no per-round scoring; play through, host awards positional points on the end reward screen, like other games) |

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
7. **Example fixture** — add an entry for the new type to `EXAMPLE_GAMES` in `server/example-games.ts` (real questions; declare any media via `MediaItem` + a generator in `server/example-media.ts`). Add a `tests/unit/fixtures/example-games.test.ts` assertion if the type needs special handling
7a. **Rules** — populate the fixture's `rules` array using the canonical archetypes in [specs/rules-standard.md](specs/rules-standard.md). Do NOT compose rules from scratch — pick the matching archetype (A/B/C) or, for a genuinely new mechanic, add a new Archetype X entry to the spec in the same commit
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
| Media URLs | Never interpolate a raw asset path into an `<img>`/`<audio>`/`<video>` `src` (or `new Audio()` / `fetch()`), or filenames containing `#`/`?`/`&` silently break the request (the browser truncates at `#` → 404 → looks like a codec error). Build the src via `toMediaSrc()` / `assetUrl()` / `encodeAssetPath()` from [src/utils/assetUrl.ts](src/utils/assetUrl.ts) (per-segment percent-encoding; absolute `http(s):`/`data:`/`blob:` URLs pass through). Config stores **raw** logical paths — encode only at the DOM `src` boundary, never the stored value (asset rename/move matches raw disk paths). |
| File exploration | **Never** use `find`, `ls`, `cat`, `head`, or `tail` via Bash for local files. Use `Read` for known paths, `Glob` for pattern-based discovery (e.g. `**/*.tsx`), and `Grep` for content search. Each Bash call triggers a permission prompt and slows the workflow — dedicated tools skip the prompt entirely. Reserve Bash for git, npm, scripts, and other shell-only operations |
| Specs | Read relevant specs before every task. Update the spec immediately whenever implementation diverges, new behaviour is added, or any acceptance criterion changes. Never finish a task with a spec that doesn't match what was built |
| API contracts | Every change to an HTTP route or WebSocket channel MUST update [specs/api/openapi.yaml](specs/api/openapi.yaml) and/or [specs/api/asyncapi.yaml](specs/api/asyncapi.yaml) in the same commit. Zone changes also update the relevant [docs/replace-*.md](docs/) guide. Run `npm run contracts:lint` + `npm run test:contracts` before declaring done. See §2a above |
| Testing | **Default — related tests only:** after changing source files, run `npm run test:related -- <paths of changed files>` (vitest `--related` runs every test whose import graph reaches the changed code). **Escalate to full suite (`npm test`) only when shared code changes:** `src/types/config.ts`, `src/types/game.ts`, `src/context/GameContext.tsx`, `src/components/games/BaseGameWrapper.tsx`, `src/components/games/GameFactory.tsx`, `src/components/common/AwardPoints.tsx`, `src/services/api.ts`, `server/index.ts`, `server/ws.ts`, `server/whisper-jobs.ts`, or `validate-config.ts`. All selected tests must pass before a task is done. When adding a new feature: write tests covering the new behaviour. When changing existing code: update any tests that cover the changed behaviour so they reflect the new reality — never delete or disable a test to make the suite pass. If a test fails after a change, either fix the code or update the test, but never ignore it |
| Responsive | Every frontend change must be responsive. Use `clamp()` for font-sizes/padding, CSS Grid or flexbox with responsive rules, and media queries aligned to the breakpoint system (576/768/1024/1400px). Never use fixed widths without a responsive fallback. The admin uses a hamburger off-canvas drawer below 1024px; the gameshow uses fluid typography |
| Frontend verification | After any frontend change (`.tsx`, `.css`, UI text), use Playwright MCP to take screenshots at **375px** (phone), **768px** (tablet), **1024px** (laptop), and **1920px** (projector) to verify the change is responsive and visually correct at all sizes |
| JSON trailing newline | Every JSON file must end with a trailing `\n`. When using Write: `content` must end with `\n`. When using Edit: never let an edit strip the final newline. Verify after every JSON edit. |
| Image filenames (people) | When downloading an image of a person, name the file `Vorname Nachname.<ext>` — full first + last name, real spaces (not hyphens or underscores), proper case. Example: `Matthew Mercer.jpg`, not `mercer.jpg` or `matthew-mercer.jpg`. |
| Rules phrasing | Every game's `rules` array must follow the canonical archetypes in [specs/rules-standard.md](specs/rules-standard.md). Reuse the archetype lines verbatim — do not paraphrase. Task line first, mechanic lines second. If a genuinely new mechanic appears, add it as a new Archetype X entry to the spec in the same commit |
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
- **Don't** skip `npm run validate` after config changes
- **Don't** use English for player-facing text
- **Don't** store derived state — compute it from raw state at read time
- **Don't** commit `config.json` if git-crypt is not active
- **Don't** use `find`, `ls`, `cat`, `head`, or `tail` via Bash for local files — use `Read` / `Glob` / `Grep` instead. Bash calls trigger permission prompts and slow the workflow
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
- **Don't** write ad-hoc game rules — every recurring mechanic has canonical phrasing in [specs/rules-standard.md](specs/rules-standard.md). Reuse the archetype lines verbatim instead of paraphrasing.

---

*Update this file whenever new game types, architectural patterns, or spec conventions are added.*
