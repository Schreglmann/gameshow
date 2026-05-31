# Spec: Clean Install

## Goal
A third party who clones the repo without the git-crypt key gets a clean, working installation with template games — no remnants of the maintainer's specific gameshows or game content.

## Acceptance criteria
- [x] `config.json` is git-crypt encrypted alongside `games/*.json`
- [x] On a fresh clone without the git-crypt key, the server starts successfully and serves a working gameshow
- [x] The active gameshow on a fresh clone is built from the `_template-<type>.json` files (one entry per game type that has a `template` instance)
- [x] No traces of the maintainer's gameshow names, gameOrder, or game files appear anywhere in the running app
- [x] The player-facing flow (landing → game → next → summary) works end-to-end on a fresh clone, using template content
- [x] Admin games tab shows the `_template-*` files in clean-install mode (so the user can edit them); in normal mode, templates remain hidden as today
- [x] Encrypted (git-crypt blob) game files are silently skipped from the admin listing — no "JSON-Fehler" badges for them
- [x] `npm run validate` does not crash when `config.json` is encrypted; it reports "config.json is git-crypt encrypted, skipping validation" and exits 0
- [x] `/api/settings` exposes `isCleanInstall: boolean` so the frontend can adjust UI (e.g. show templates in admin)
- [x] On server start, if `config.json` is **missing** or a **git-crypt blob**, the server writes a fresh template-based `config.json` to disk (so the admin config editor and any direct readers work, not just the in-memory fallback)
- [x] When an encrypted `config.json` is replaced, its original blob is preserved as `config.json.git-crypt.bak` (never clobbering an existing backup) and the backup is gitignored
- [x] A valid plaintext `config.json` is never overwritten; a malformed (non-encrypted) `config.json` is also left untouched (could be a half-finished hand edit — the in-memory fallback still serves it)
- [x] After a default `config.json` is materialized, the app still reports `isCleanInstall: true` for as long as the active gameshow references only `_template-*` games, so the admin keeps showing the templates for editing

## State / data changes
- `.gitattributes`: add `config.json filter=git-crypt diff=git-crypt`
- New server helper: `isGitCryptBlob(filePath): Promise<boolean>` — checks for the `\x00GITCRYPT\x00` magic prefix
- New server helper: `buildDefaultConfig(): Promise<AppConfig>` — scans `games/_template-*.json`, builds an in-memory `AppConfig` with one gameshow `default` whose `gameOrder` references each template that has an `instances.template`
- `loadConfig()` fallback chain: try `config.json` → if missing OR git-crypt blob OR JSON parse fails → return `buildDefaultConfig()`
- `SettingsResponse` gains `isCleanInstall: boolean`
- New server helper: `ensureConfigFile(configPath, gamesDir): Promise<EnsureConfigResult>` — called once at startup. Materializes a default `config.json` when the file is missing or a git-crypt blob; backs up an encrypted blob to `config.json.git-crypt.bak` first; no-ops for valid or malformed plaintext. Writes atomically (tmp + rename), 2-space indent, trailing newline
- New server helper: `configReferencesOnlyTemplates(config): boolean` — true when the active gameshow's `gameOrder` is non-empty and every entry starts with `_template-`. `loadConfig()` sets `cleanInstallActive = isCleanInstall || configReferencesOnlyTemplates(config)` so a materialized default still counts as a clean install
- `.gitignore` ignores `config.json.git-crypt.bak`

## Server behaviour
- **Startup materialization**: the `app.listen` callback calls `ensureConfigFile(CONFIG_PATH, GAMES_DIR)` before anything else. Logs which action it took (kept / created-missing / created-encrypted, including the backup path). After this runs, `config.json` is a real plaintext file on disk for every subsequent request — including direct readers like `GET`/`PUT /api/backend/config` (admin config editor) that bypass `loadConfig()`.
- `loadConfig()` ([server/index.ts:1431](../server/index.ts#L1431)) returns either the parsed `config.json` or the built-in default. Logs which one was used at startup.
- `GET /api/settings` includes `isCleanInstall` (true when `loadConfig()` used the fallback)
- `GET /api/game/:index` works against the fallback config — resolves `_template-<type>/template` references through `loadGameConfig()` unchanged
- `GET /api/backend/games` skips files that are git-crypt blobs entirely. Always includes `_template-*` files in the response (the client decides whether to render them based on `isCleanInstall`)
- `validate-config.ts` detects encrypted `config.json` via the same magic-byte check and skips with a friendly message

## UI behaviour
- **Landing screen**: unchanged — works as today since the fallback config has a valid `gameOrder`
- **GamesTab** ([src/components/backend/GamesTab.tsx:204](../src/components/backend/GamesTab.tsx#L204), [GamesTab.tsx:228](../src/components/backend/GamesTab.tsx#L228)): replace the hardcoded `!fileName.startsWith('_')` filter with `isCleanInstall || !fileName.startsWith('_')`. In clean-install mode, templates appear; otherwise the existing behaviour stands
- **Admin status / banner** (optional): no banner required for v1 — the presence of the templates in the games list is signal enough

## Edge cases
- Maintainer machine *with* the git-crypt key: `config.json` decrypts on disk, parsing succeeds, normal flow — `isCleanInstall: false`
- Maintainer machine, brand-new clone, no key: `config.json` is encrypted blob, fallback engages — `isCleanInstall: true`
- Partial encryption (some `games/*.json` decrypted, some not): listed cleanly — encrypted ones omitted, decrypted ones shown
- `games/_template-*.json` missing entirely (deleted by user): fallback gameOrder is empty; landing screen shows the existing "no games" path (graceful). `ensureConfigFile` still writes a config.json with an empty gameOrder
- `config.json` exists but is malformed JSON (not encrypted): fallback engages, treated as a clean install. `ensureConfigFile` does **not** overwrite it — the user's broken edit is preserved on disk
- Maintainer with the git-crypt key but a locked repo (config.json is an encrypted blob): on first start the blob is moved to `config.json.git-crypt.bak` and a default is written. To restore the real config: `git checkout config.json` (or `git-crypt unlock` once the working tree is clean), then delete the backup
- `config.json.git-crypt.bak` already exists from a prior start: the existing backup is kept (treated as the authoritative original) and the current encrypted blob is simply replaced

## Out of scope
- Auto-bootstrapping `_template-*.json` into non-prefixed real game files on disk (considered, rejected — keeps disk state under user control)
- A first-run setup wizard or admin onboarding flow
- Importing/exporting gameshow definitions
- Per-user config separation
