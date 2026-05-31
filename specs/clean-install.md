# Spec: Clean Install

## Goal
A third party who clones the repo without the git-crypt key gets a clean, working installation — the server starts, the admin is usable, and example content can be generated on demand. No remnants of the maintainer's specific gameshows or game content appear.

## Acceptance criteria
- [x] `config.json` is git-crypt encrypted alongside `games/*.json`
- [x] On a fresh clone without the git-crypt key, the server starts successfully (no crash)
- [x] Encrypted (git-crypt blob) game files are silently skipped from the admin listing — no "JSON-Fehler" badges for them
- [x] `npm run validate` does not crash when `config.json` is encrypted; it reports "config.json is git-crypt encrypted, skipping validation" and exits 0
- [x] `/api/settings` exposes `isCleanInstall: boolean` (true when `config.json` was missing/encrypted/unparseable)
- [x] On server start, if `config.json` is **missing** or a **git-crypt blob**, the server writes a fresh minimal `config.json` to disk — a single empty `beispiele` gameshow — so the admin config editor and any direct readers work, not just the in-memory fallback
- [x] When an encrypted `config.json` is replaced, its original blob is preserved as `config.json.git-crypt.bak` (never clobbering an existing backup) and the backup is gitignored
- [x] A valid plaintext `config.json` is never overwritten; a malformed (non-encrypted) `config.json` is also left untouched (could be a half-finished hand edit — the in-memory fallback still serves it)
- [x] The admin "Spiele" tab offers a **"Beispiele erstellen"** button when no games are present, which generates example games for every type — see [specs/example-games.md](example-games.md)

## State / data changes
- `.gitattributes`: `config.json filter=git-crypt diff=git-crypt`; all `games/*.json` encrypted (generated `games/beispiel-*.json` are gitignored, never committed)
- Server helper: `isGitCryptBlob(buffer): boolean` — checks for the `\x00GITCRYPT\x00` magic prefix
- Server helper: `buildDefaultConfig(): AppConfig` — returns a minimal `AppConfig` with one empty `beispiele` gameshow (active) plus `globalRules` and `rulesPresets`. No filesystem scan
- `loadConfigWithFallback(configPath)` fallback chain: try `config.json` → if missing OR git-crypt blob OR JSON parse fails → return `buildDefaultConfig()`
- `SettingsResponse` has `isCleanInstall: boolean`
- Server helper: `ensureConfigFile(configPath): Promise<EnsureConfigResult>` — called once at startup. Materializes the default `config.json` when the file is missing or a git-crypt blob; backs up an encrypted blob to `config.json.git-crypt.bak` first; no-ops for valid or malformed plaintext. Writes atomically (tmp + rename), 2-space indent, trailing newline
- `.gitignore` ignores `config.json.git-crypt.bak`

## Server behaviour
- **Startup materialization**: the `app.listen` callback calls `ensureConfigFile(CONFIG_PATH)` before anything else. Logs which action it took (kept / created-missing / created-encrypted, including the backup path). After this runs, `config.json` is a real plaintext file on disk for every subsequent request — including direct readers like `GET`/`PUT /api/backend/config` (admin config editor) that bypass `loadConfig()`.
- `loadConfig()` returns either the parsed `config.json` or the built-in default, and sets `cleanInstallActive = isCleanInstall`.
- `GET /api/settings` includes `isCleanInstall` (true when the fallback was used).
- `GET /api/backend/games` skips files that are git-crypt blobs entirely (a fresh encrypted clone shows an empty list → the admin then offers "Beispiele erstellen").
- `validate-config.ts` detects encrypted `config.json` via the same magic-byte check and skips with a friendly message.

## UI behaviour
- **Landing screen**: works once the active gameshow has a non-empty `gameOrder` (after the user generates examples or wires up real games).
- **GamesTab**: when the games list is empty, shows the "Beispiele erstellen" button (covers both no-games and encrypted-clone, since encrypted games are skipped from the listing). See [specs/example-games.md](example-games.md).

## Edge cases
- Maintainer machine *with* the git-crypt key: `config.json` decrypts on disk, parsing succeeds, normal flow — `isCleanInstall: false`.
- Maintainer machine, brand-new clone, no key: `config.json` is an encrypted blob → backed up to `config.json.git-crypt.bak`, a minimal default is written, `isCleanInstall: true`.
- Partial encryption (some `games/*.json` decrypted, some not): listed cleanly — encrypted ones omitted, decrypted ones shown.
- `config.json` exists but is malformed JSON (not encrypted): fallback engages, treated as a clean install. `ensureConfigFile` does **not** overwrite it — the user's broken edit is preserved on disk.
- Maintainer with the git-crypt key but a locked repo (config.json is an encrypted blob): on first start the blob is moved to `config.json.git-crypt.bak` and a default is written. To restore the real config: `git checkout config.json` (or `git-crypt unlock` once the working tree is clean), then delete the backup.
- `config.json.git-crypt.bak` already exists from a prior start: the existing backup is kept (treated as the authoritative original) and the current encrypted blob is simply replaced.

## Out of scope
- The example-game content + media generation itself — see [specs/example-games.md](example-games.md).
- A first-run setup wizard or admin onboarding flow beyond the single button.
- Importing/exporting gameshow definitions.
- Per-user config separation.
