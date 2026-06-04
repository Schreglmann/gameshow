# Spec: Spelling & Grammar Check ("Lektorat")

## Goal
Let the author check every German prose field in a game (or the whole show) for spelling
**and** grammar mistakes, fix them in place, and permanently allow false positives — with a
global on/off switch that is **off by default**.

## Acceptance criteria
- [x] A new **Lektorat** tab exists in the admin. It hosts a **master on/off switch**; the
      whole feature is **off by default** (fresh install, missing config file → off).
- [x] While the master switch is **off**, no spell-check UI appears anywhere: no per-game
      button, no inline underlines, no scanning. The app behaves exactly as before.
- [x] When **on**, the Lektorat tab can scan all games of the active gameshow (option to scan
      every game) and shows a report grouped by game → instance → question/field, with a
      progress indicator while scanning.
- [x] The game editor shows a "Rechtschreibung prüfen" toggle (only when the feature is on)
      that checks the currently-open game and shows the same report.
- [x] Each reported issue offers: **Übernehmen** (apply a suggestion → edits the field and
      auto-saves), **Wort erlauben** (adds the word to a permanent allowlist; it never
      re-flags anywhere), **Ignorieren** (suppresses that specific grammar match by fingerprint).
- [x] Spelling and grammar are both detected via LanguageTool. Each field's language is
      **auto-detected** (`language=auto`, preferring `de-DE`/`en-US`), so English answers
      (song/movie/band names) are checked as English and German text as German — neither is
      flagged as the other. The endpoint is configurable via `LANGUAGETOOL_URL` (default
      `https://api.languagetool.org`) and the language via `LANGUAGETOOL_LANGUAGE` (default `auto`).
- [x] Inline squiggly underlines appear on the editor's prose fields when the feature + the
      per-game toggle are on (red = spelling, blue = grammar/style); clicking a flagged word
      opens a popover with suggestions + Erlauben/Ignorieren. (Bandle's answer/track fields are
      catalog-driven read-only text, so they are covered by the report panel, not inline.)
- [x] The allowlist + master switch persist in a repo-root `spellcheck-allowlist.json`
      (plaintext, committed, NOT git-crypt encrypted).
- [x] Every prose field of every game type is checkable; non-prose (filenames, asset paths,
      numbers, hex colors, FAKT/FAKE, flags) is never sent to the checker.
- [x] All new HTTP routes are documented in `specs/api/openapi.yaml` + `inventory.md` +
      `docs/replace-admin.md`; `npm run contracts:lint` passes.

## Performance
- **Two-pass auto-detection:** with `language=auto`, fields are first checked in batched
  requests (dominant-language detection, cheap), then only the fields that flagged are
  re-checked individually so each field's true language wins. Clean German content costs ~1
  request per game; only flagged fields incur a per-field request.
- **Response cache (persistent):** per-field results are cached (keyed by language + text), so
  re-scans and re-checks after editing one field reuse prior responses — a repeat scan of
  unchanged content makes **no** API calls. The cache is **persisted to a gitignored sidecar**
  `.spellcheck-cache.json` (atomic tmp-write + rename, debounced) and reloaded on startup, so it
  **survives server restarts** (including `tsx watch` reloads in dev): once content has been
  scanned, scanning it again after a restart is instant. Disabled under vitest (never touches
  disk in tests). The allowlist is applied at read time, so allowing a word takes effect against
  cached results without re-fetching.
- **Concurrent requests + sliding-window rate limiter:** requests run concurrently (default 6
  in-flight). On the public API a global **sliding-window** limiter keeps a log of the last
  minute's requests and only makes a caller wait once the window is actually full (~18 req /
  ~70 KB per minute, leaving headroom under the public API's ~20 req / ~75 KB cap). So a normal
  show fires its handful of requests in one burst and completes in a few seconds — **no** fixed
  per-request delay. Only large shows / rapid re-scans get throttled, and only after the burst.
  A self-hosted `LANGUAGETOOL_URL` is never throttled.
- **Visible throttling:** while a scan is running the UI polls `GET /api/backend/spellcheck/
  rate-status` once a second and shows a banner ("Ratenlimit erreicht – warte ~N s") whenever
  requests are parked, so the user knows the scan is waiting on the rate limit rather than stuck.
- Against the free public API a first scan of very large, proper-noun-heavy shows can still be
  bounded by the per-minute cap (every flagged field is a re-check). The persistent cache makes
  every subsequent scan instant, but the **only** way to guarantee a fast first scan is to
  self-host LanguageTool — there is no per-minute limit, so all requests run concurrently:
  ```bash
  docker run -d --name languagetool -p 8010:8010 erikvl87/languagetool
  # then start the gameshow server with:
  LANGUAGETOOL_URL=http://localhost:8010
  ```
  With a self-hosted endpoint the rate limiter is bypassed entirely and a whole show checks in
  a few seconds even cold.

## State / data changes
- **New sidecar file** `spellcheck-allowlist.json` at repo root:
  `{ version: 1, enabled: boolean, allowedWords: string[], ignoredMatches: string[] }`.
  `enabled` defaults to `false`. `ignoredMatches` holds match fingerprints.
- **New cache sidecar** `.spellcheck-cache.json` at repo root (gitignored, ephemeral):
  `{ version: 1, entries: [key, matches][] }`. Persists the in-memory response cache so it
  survives restarts. Not committed; safe to delete (rebuilt on next scan).
- **No `AppState` change** — this is admin-only CMS state, not gameshow runtime state.
- **New env vars** `LANGUAGETOOL_URL` (default `https://api.languagetool.org`) and
  `LANGUAGETOOL_LANGUAGE` (default `auto` — per-field language detection). Each field is
  checked in its own request so auto-detection is per field (no cross-field batching).
- **New API endpoints** (admin zone, all under `/api/backend/spellcheck`):
  - `POST /check` — `{ segments: { key, text }[] }` → `{ results: { key, matches }[] }`
    (allowlist-filtered, offsets local to each segment).
  - `GET /allowlist` → the full config object.
  - `POST /set-enabled` — `{ enabled: boolean }` → updated config.
  - `POST /allow-word` `{ word }`, `POST /remove-word` `{ word }` → updated config.
  - `POST /ignore-match` `{ fingerprint }`, `POST /remove-ignore` `{ fingerprint }` → updated config.
  - `GET /health` → `{ ok, url, reason? }`.
  - `GET /rate-status` → `{ throttling, waiting, retryAfterMs, windowCount, windowMax }` (live
    rate-limiter state; the scan UI polls this to show a "waiting on rate limit" banner).
- **Fingerprint contract:** `` `${ruleId}::${matched.normalize('NFC').toLowerCase().trim()}` ``.
  Shared between server and client so "is this match ignored?" agrees byte-for-byte.

## UI behaviour
- **Lektorat tab** (`LektoratTab`): master switch at top (off by default). When on: a
  "Spiele prüfen" / "Alle Spiele prüfen" action runs the scan (≤3 concurrent requests, one per
  game instance), a progress line ("3 / 18 Spiele geprüft"), the grouped report, and a
  dictionary-management area (allowed words + ignored matches, each removable).
- **Game editor** (`GameEditor`): a header toggle (shown only when the feature is on) reveals
  inline underlines + a per-game report panel for the current instance. Applying a fix flows
  through `setData`/`updateInstance` so the existing 800 ms auto-save persists it.
- **Report panel** (`SpellCheckPanel`): issue cards with label ("Frage 4 · Antwort"), the
  flagged text in context (red/blue), the LanguageTool message, and the three actions. Empty
  state: "Keine Auffälligkeiten gefunden."
- **Inline field** (`SpellField`): drop-in replacement for the prose `<input>`/`<textarea>`;
  renders identically to a plain input when the feature is off or the field has no matches.
- **Edge cases:** LanguageTool unreachable / rate-limited → the report shows a clear error and
  the rest of the admin is unaffected. Empty/whitespace fields are skipped. Multi-instance
  games: base `title`/`rules` checked once; per-instance overrides + questions checked per
  instance. Quizjagd is read in its flat on-disk shape.

## Out of scope
- Languages other than German + English (auto-detected).
- Auto-fixing without user confirmation; bulk "fix all".
- Style/picky-level rules (LanguageTool `level=default` only) — may be added later.
- Checking config.json gameshow names or asset metadata (only `games/*.json` prose).
